using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class Dns64ConfigValidator
{
    private static readonly int[] ValidDns64PrefixLengths = [32, 40, 48, 56, 64, 96];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (root.TryGetPropertyValue("appPreference", out JsonNode? prefNode))
        {
            if (!TryGetScalarKind(prefNode, out JsonValueKind prefKind) || prefKind != JsonValueKind.Number)
                errors.Add("'appPreference' must be a number.");
            else if ((prefNode!.GetValue<double>() < 0) || (prefNode.GetValue<double>() > 255) || (prefNode.GetValue<double>() != Math.Floor(prefNode.GetValue<double>())))
                errors.Add("'appPreference' must be a whole number between 0 and 255.");
        }

        if (!root.TryGetPropertyValue("enableDns64", out JsonNode? enableNode) || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
            errors.Add("'enableDns64' is required and must be a boolean.");

        ValidateNetworkGroupMap(root, errors);
        ValidateGroups(root, errors);

        return errors;
    }

    private static void ValidateNetworkGroupMap(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("networkGroupMap", out JsonNode? mapNode) || mapNode is not JsonObject map)
        {
            errors.Add("'networkGroupMap' is required and must be an object.");
            return;
        }

        foreach (KeyValuePair<string, JsonNode?> kv in map)
        {
            string prefix = $"networkGroupMap[\"{kv.Key}\"]";

            if (!NetworkAddressHelper.TryParse(kv.Key, out _, out _))
                errors.Add($"{prefix} has an invalid network key - the app fails to reload with an unparseable network address.");

            if (!TryGetString(kv.Value, out string groupName) || string.IsNullOrWhiteSpace(groupName))
                errors.Add($"{prefix} must map to a non-empty group name string.");
        }
    }

    private static void ValidateGroups(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("groups", out JsonNode? groupsNode) || groupsNode is not JsonArray groups)
        {
            errors.Add("'groups' is required and must be an array.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < groups.Count; i++)
        {
            string prefix = $"groups[{i}]";

            if (groups[i] is not JsonObject group)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!group.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!seenNames.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one group - the app fails to reload with a duplicate group name.");

            if (!group.TryGetPropertyValue("enableDns64", out JsonNode? enableNode) || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
                errors.Add($"{prefix}.enableDns64 is required and must be a boolean.");

            ValidateDns64PrefixMap(group, prefix, errors);
            ValidateExcludedIpv6(group, prefix, errors);
        }
    }

    private static void ValidateDns64PrefixMap(JsonObject group, string prefix, List<string> errors)
    {
        if (!group.TryGetPropertyValue("dns64PrefixMap", out JsonNode? mapNode) || mapNode is not JsonObject map)
        {
            errors.Add($"{prefix}.dns64PrefixMap is required and must be an object.");
            return;
        }

        foreach (KeyValuePair<string, JsonNode?> kv in map)
        {
            string entryPrefix = $"{prefix}.dns64PrefixMap[\"{kv.Key}\"]";

            if (!NetworkAddressHelper.TryParse(kv.Key, out _, out _))
                errors.Add($"{entryPrefix} has an invalid network key - the app fails to reload with an unparseable network address.");

            if (kv.Value is null)
                continue;

            if (!TryGetString(kv.Value, out string dns64Prefix) || string.IsNullOrWhiteSpace(dns64Prefix))
            {
                errors.Add($"{entryPrefix} must be a string DNS64 prefix, or null to exclude this network.");
                continue;
            }

            if (!NetworkAddressHelper.TryParse(dns64Prefix, out _, out int prefixLength) || !ValidDns64PrefixLengths.Contains(prefixLength))
                errors.Add($"{entryPrefix} must be a valid CIDR whose prefix length is one of: {string.Join(", ", ValidDns64PrefixLengths)}.");
        }
    }

    private static void ValidateExcludedIpv6(JsonObject group, string prefix, List<string> errors)
    {
        if (!group.TryGetPropertyValue("excludedIpv6", out JsonNode? arrayNode) || arrayNode is not JsonArray array)
        {
            errors.Add($"{prefix}.excludedIpv6 is required and must be an array.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            string entryPrefix = $"{prefix}.excludedIpv6[{i}]";

            if (!TryGetString(array[i], out string network) || !NetworkAddressHelper.TryParse(network, out System.Net.IPAddress? address, out _))
            {
                errors.Add($"{entryPrefix} must be a valid IPv6 CIDR.");
                continue;
            }

            if (address!.AddressFamily != AddressFamily.InterNetworkV6)
                errors.Add($"{entryPrefix} must be an IPv6 address - the app fails to reload with an IPv4 entry here.");
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
}
