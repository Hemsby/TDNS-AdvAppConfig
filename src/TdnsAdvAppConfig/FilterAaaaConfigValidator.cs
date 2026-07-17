using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class FilterAaaaConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalBool(root, "enableFilterAaaa", errors);
        ValidateOptionalBool(root, "bypassLocalZones", errors);
        ValidateOptionalDefaultTtl(root, errors);

        ValidateOptionalNetworkArray(root, "bypassNetworks", errors);
        ValidateOptionalStringArray(root, "bypassDomains", errors);
        ValidateOptionalStringArray(root, "filterDomains", errors);

        return errors;
    }

    private static void ValidateOptionalBool(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"'{field}' must be a boolean.");
    }

    private static void ValidateOptionalDefaultTtl(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("defaultTtl", out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number)
            errors.Add("'defaultTtl' must be a number.");
    }

    private static void ValidateOptionalNetworkArray(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"'{field}' must be an array (or null).");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string network) || !NetworkAddressHelper.TryParse(network, out _, out _))
                errors.Add($"{field}[{i}] must be a valid IP address or CIDR range - the app fails to reload with an unparseable entry.");
        }
    }

    private static void ValidateOptionalStringArray(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"'{field}' must be an array (or null).");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out _))
                errors.Add($"{field}[{i}] must be a string.");
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
