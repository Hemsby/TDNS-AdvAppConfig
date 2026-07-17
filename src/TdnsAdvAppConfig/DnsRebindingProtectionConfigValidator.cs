using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class DnsRebindingProtectionConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (root.TryGetPropertyValue("enableProtection", out JsonNode? enableNode))
        {
            if (!TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
                errors.Add("'enableProtection' must be a boolean.");
        }

        ValidateNetworkArray(root, "privateNetworks", errors, required: true);
        ValidateNetworkArray(root, "bypassNetworks", errors, required: false);

        if (!root.TryGetPropertyValue("privateDomains", out JsonNode? domainsNode) || domainsNode is not JsonArray domainsArray)
        {
            errors.Add("'privateDomains' is required and must be an array.");
        }
        else
        {
            for (int i = 0; i < domainsArray.Count; i++)
            {
                if (!TryGetString(domainsArray[i], out string domain) || string.IsNullOrWhiteSpace(domain))
                    errors.Add($"privateDomains[{i}] must be a non-empty string.");
            }
        }

        return errors;
    }

    private static void ValidateNetworkArray(JsonObject root, string field, List<string> errors, bool required)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
        {
            if (required)
                errors.Add($"'{field}' is required and must be an array.");

            return;
        }

        if (node is not JsonArray array)
        {
            errors.Add($"'{field}' must be an array.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string network) || !NetworkAddressHelper.TryParse(network, out _, out _))
                errors.Add($"{field}[{i}] must be a valid IP address or CIDR range - the app fails to reload with an unparseable entry.");
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
