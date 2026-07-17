using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class AdvancedForwardingConfigValidator
{
    private static readonly string[] ValidProxyTypes = ["Http", "Socks5"];
    private static readonly string[] ValidForwarderProtocols = ["Udp", "Tcp", "Tls", "Https", "HttpsJson", "Quic"];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalNonNegativeNumber(root, "appPreference", errors);
        ValidateOptionalBool(root, "enableForwarding", errors);

        HashSet<string> proxyNames = ValidateProxyServers(root, errors);
        HashSet<string> forwarderNames = ValidateForwarders(root, errors, proxyNames);

        if (!root.TryGetPropertyValue("networkGroupMap", out JsonNode? networkMapNode) || networkMapNode is not JsonObject networkMap)
            errors.Add("'networkGroupMap' is required and must be an object.");
        else
            ValidateStringMapValues(networkMap, "networkGroupMap", errors);

        ValidateGroups(root, errors, forwarderNames);

        return errors;
    }

    private static HashSet<string> ValidateProxyServers(JsonObject root, List<string> errors)
    {
        HashSet<string> names = new(StringComparer.Ordinal);

        if (!root.TryGetPropertyValue("proxyServers", out JsonNode? node) || node is null)
            return names;

        if (node is not JsonArray array)
        {
            errors.Add("'proxyServers' must be an array.");
            return names;
        }

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"proxyServers[{i}]";

            if (array[i] is not JsonObject proxy)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!proxy.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!names.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one proxy server - duplicate names will silently shadow each other server-side.");

            if (proxy.TryGetPropertyValue("type", out JsonNode? typeNode) && typeNode is not null)
            {
                if (!TryGetString(typeNode, out string type) || !ValidProxyTypes.Contains(type, StringComparer.OrdinalIgnoreCase))
                    errors.Add($"{prefix}.type must be one of: {string.Join(", ", ValidProxyTypes)}.");
            }

            if (!proxy.TryGetPropertyValue("proxyAddress", out JsonNode? addrNode) || !TryGetString(addrNode, out string addr) || string.IsNullOrWhiteSpace(addr))
                errors.Add($"{prefix}.proxyAddress is required and must be a non-empty string.");

            if (!proxy.TryGetPropertyValue("proxyPort", out JsonNode? portNode) || !TryGetScalarKind(portNode, out JsonValueKind portKind) || portKind != JsonValueKind.Number)
            {
                errors.Add($"{prefix}.proxyPort is required and must be a number.");
            }
            else
            {
                double port = portNode!.GetValue<double>();
                if (port < 0 || port > 65535)
                    errors.Add($"{prefix}.proxyPort must be between 0 and 65535.");
            }
        }

        return names;
    }

    private static HashSet<string> ValidateForwarders(JsonObject root, List<string> errors, HashSet<string> proxyNames)
    {
        HashSet<string> names = new(StringComparer.Ordinal);

        if (!root.TryGetPropertyValue("forwarders", out JsonNode? node) || node is null)
            return names;

        if (node is not JsonArray array)
        {
            errors.Add("'forwarders' must be an array.");
            return names;
        }

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"forwarders[{i}]";

            if (array[i] is not JsonObject forwarder)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!forwarder.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!names.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one forwarder - duplicate names will silently shadow each other server-side.");

            if (forwarder.TryGetPropertyValue("proxy", out JsonNode? proxyNode) && proxyNode is not null)
            {
                if (!TryGetString(proxyNode, out string proxyName) || string.IsNullOrWhiteSpace(proxyName))
                    errors.Add($"{prefix}.proxy must be a non-empty string when present.");
                else if (!proxyNames.Contains(proxyName))
                    errors.Add($"{prefix}.proxy references \"{proxyName}\", which isn't defined in 'proxyServers' - the app fails to reload with an undefined proxy reference.");
            }

            ValidateOptionalBool(forwarder, "dnssecValidation", errors, prefix);

            if (forwarder.TryGetPropertyValue("forwarderProtocol", out JsonNode? protoNode) && protoNode is not null)
            {
                if (!TryGetString(protoNode, out string protocol) || !ValidForwarderProtocols.Contains(protocol, StringComparer.OrdinalIgnoreCase))
                    errors.Add($"{prefix}.forwarderProtocol must be one of: {string.Join(", ", ValidForwarderProtocols)}.");
            }

            if (!forwarder.TryGetPropertyValue("forwarderAddresses", out JsonNode? addrsNode) || addrsNode is not JsonArray addrsArray || addrsArray.Count == 0)
            {
                errors.Add($"{prefix}.forwarderAddresses is required and must be a non-empty array of strings.");
            }
            else
            {
                for (int j = 0; j < addrsArray.Count; j++)
                {
                    if (!TryGetString(addrsArray[j], out string addrVal) || string.IsNullOrWhiteSpace(addrVal))
                        errors.Add($"{prefix}.forwarderAddresses[{j}] must be a non-empty string.");
                }
            }
        }

        return names;
    }

    private static void ValidateGroups(JsonObject root, List<string> errors, HashSet<string> forwarderNames)
    {
        if (!root.TryGetPropertyValue("groups", out JsonNode? groupsNode) || groupsNode is not JsonArray groupsArray)
        {
            errors.Add("'groups' is required and must be an array.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < groupsArray.Count; i++)
        {
            string prefix = $"groups[{i}]";

            if (groupsArray[i] is not JsonObject group)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!group.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!seenNames.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one group - duplicate names will silently shadow each other server-side.");

            ValidateOptionalBool(group, "enableForwarding", errors, prefix);

            if (!group.TryGetPropertyValue("forwardings", out JsonNode? forwardingsNode) || forwardingsNode is null)
                continue;

            if (forwardingsNode is not JsonArray forwardingsArray)
            {
                errors.Add($"{prefix}.forwardings must be an array.");
                continue;
            }

            for (int j = 0; j < forwardingsArray.Count; j++)
            {
                string fPrefix = $"{prefix}.forwardings[{j}]";

                if (forwardingsArray[j] is not JsonObject forwarding)
                {
                    errors.Add($"{fPrefix} must be an object.");
                    continue;
                }

                if (!forwarding.TryGetPropertyValue("forwarders", out JsonNode? fwdersNode) || fwdersNode is not JsonArray fwdersArray || fwdersArray.Count == 0)
                {
                    errors.Add($"{fPrefix}.forwarders is required and must be a non-empty array of forwarder names.");
                }
                else
                {
                    for (int k = 0; k < fwdersArray.Count; k++)
                    {
                        if (!TryGetString(fwdersArray[k], out string fwderName) || string.IsNullOrWhiteSpace(fwderName))
                            errors.Add($"{fPrefix}.forwarders[{k}] must be a non-empty string.");
                        else if (!forwarderNames.Contains(fwderName))
                            errors.Add($"{fPrefix}.forwarders[{k}] references \"{fwderName}\", which isn't defined in 'forwarders' - the app fails to reload with an undefined forwarder reference.");
                    }
                }

                if (!forwarding.TryGetPropertyValue("domains", out JsonNode? domainsNode) || domainsNode is not JsonArray domainsArray || domainsArray.Count == 0)
                {
                    errors.Add($"{fPrefix}.domains is required and must be a non-empty array of strings.");
                }
                else
                {
                    for (int k = 0; k < domainsArray.Count; k++)
                    {
                        if (!TryGetString(domainsArray[k], out string domainVal) || string.IsNullOrWhiteSpace(domainVal))
                            errors.Add($"{fPrefix}.domains[{k}] must be a non-empty string.");
                    }
                }
            }

        }
    }

    private static bool TryGetScalarKind(JsonNode? node, out JsonValueKind kind)
    {
        kind = default;

        if (node is null or JsonObject or JsonArray)
            return false;

        try
        {
            kind = node.GetValue<JsonElement>().ValueKind;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryGetString(JsonNode? node, out string value)
    {
        value = "";

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.String)
            return false;

        value = node!.GetValue<string>();
        return true;
    }

    private static void ValidateOptionalBool(JsonObject obj, string field, List<string> errors, string? prefix = null)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"{Label(prefix, field)} must be a boolean.");
    }

    private static void ValidateOptionalNonNegativeNumber(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number)
        {
            errors.Add($"'{field}' must be a number.");
            return;
        }

        if (node!.GetValue<double>() < 0)
            errors.Add($"'{field}' must not be negative.");
    }

    private static void ValidateStringMapValues(JsonObject mapObj, string field, List<string> errors)
    {
        foreach (KeyValuePair<string, JsonNode?> kv in mapObj)
        {
            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add($"'{field}' has an empty key.");
                continue;
            }

            if (!TryGetString(kv.Value, out string groupName) || string.IsNullOrWhiteSpace(groupName))
                errors.Add($"'{field}[\"{kv.Key}\"]' must map to a non-empty group name string.");
        }
    }

    private static string Label(string? prefix, string field) => prefix is null ? $"'{field}'" : $"{prefix}.{field}";
}
