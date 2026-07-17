using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class NxDomainOverrideConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalBool(root, "enableOverride", errors);
        ValidateOptionalUInt32(root, "defaultTtl", errors);

        ValidateDomainSetMap(root, errors);
        ValidateSets(root, errors);

        return errors;
    }

    private static void ValidateDomainSetMap(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("domainSetMap", out JsonNode? node) || node is not JsonObject map)
        {
            errors.Add("'domainSetMap' is required and must be an object - the app throws on every reload if it's missing, null, or any other type.");
            return;
        }

        foreach (KeyValuePair<string, JsonNode?> kv in map)
        {
            if (string.IsNullOrEmpty(kv.Key))
            {
                errors.Add("'domainSetMap' has an empty key.");
                continue;
            }

            if (kv.Value is not JsonArray sets || sets.Count == 0)
            {
                errors.Add($"domainSetMap[\"{kv.Key}\"] must be a non-empty array of set names - a null or wrong-type value crashes the first query that maps to this domain.");
                continue;
            }

            for (int i = 0; i < sets.Count; i++)
            {
                if (!TryGetString(sets[i], out string setName) || string.IsNullOrWhiteSpace(setName))
                    errors.Add($"domainSetMap[\"{kv.Key}\"][{i}] must be a non-empty string.");
            }
        }
    }

    private static void ValidateSets(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("sets", out JsonNode? node) || node is not JsonArray array)
        {
            errors.Add("'sets' is required and must be an array - a missing key or wrong type throws on every reload, and a present null crashes the first query that resolves to a set.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"sets[{i}]";

            if (array[i] is not JsonObject set)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!set.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrEmpty(name))
            {
                errors.Add($"{prefix}.name is required and must be a non-empty string - the app throws on reload otherwise (including a null name).");
            }
            else if (!seenNames.Add(name))
            {
                errors.Add($"{prefix}.name \"{name}\" is used by more than one set - the app throws on reload for a duplicate name.");
            }

            if (!set.TryGetPropertyValue("addresses", out JsonNode? addrNode) || addrNode is not JsonArray addresses || addresses.Count == 0)
            {
                errors.Add($"{prefix}.addresses is required and must be a non-empty array of IP addresses - a missing key throws on reload, and a null/empty value crashes the first query that uses this set.");
                continue;
            }

            for (int j = 0; j < addresses.Count; j++)
            {
                if (!TryGetString(addresses[j], out string addr) || !IPAddress.TryParse(addr, out _))
                    errors.Add($"{prefix}.addresses[{j}] must be a valid IP address - the app throws mid-query for an unparseable entry.");
            }
        }
    }

    private static void ValidateOptionalBool(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"'{field}' must be a boolean - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateOptionalUInt32(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetUInt32(out _))
            errors.Add($"'{field}' must be a non-negative whole number - the app throws on reload otherwise (including a present null).");
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
