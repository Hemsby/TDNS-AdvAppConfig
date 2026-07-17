using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class DefaultRecordsConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (!root.TryGetPropertyValue("enableDefaultRecords", out JsonNode? enableNode) || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
            errors.Add("'enableDefaultRecords' is required and must be a boolean.");

        if (root.TryGetPropertyValue("defaultTtl", out JsonNode? ttlNode))
        {
            if (!TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number)
                errors.Add("'defaultTtl' must be a number.");
            else if ((ttlNode!.GetValue<double>() < 0) || (ttlNode.GetValue<double>() > uint.MaxValue) || (ttlNode.GetValue<double>() != Math.Floor(ttlNode.GetValue<double>())))
                errors.Add("'defaultTtl' must be a whole number between 0 and 4294967295.");
        }

        HashSet<string> setNames = ValidateSets(root, errors);
        ValidateZoneSetMap(root, errors, setNames);

        return errors;
    }

    private static HashSet<string> ValidateSets(JsonObject root, List<string> errors)
    {
        HashSet<string> names = new(StringComparer.Ordinal);

        if (!root.TryGetPropertyValue("sets", out JsonNode? setsNode) || setsNode is not JsonArray setsArray)
        {
            errors.Add("'sets' is required and must be an array.");
            return names;
        }

        for (int i = 0; i < setsArray.Count; i++)
        {
            string prefix = $"sets[{i}]";

            if (setsArray[i] is not JsonObject set)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!set.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!names.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one set - the app fails to reload with a duplicate set name.");

            if (!set.TryGetPropertyValue("enable", out JsonNode? enableNode) || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
                errors.Add($"{prefix}.enable is required and must be a boolean.");

            if (!set.TryGetPropertyValue("records", out JsonNode? recordsNode) || recordsNode is not JsonArray recordsArray)
            {
                errors.Add($"{prefix}.records is required and must be an array.");
            }
            else
            {
                for (int j = 0; j < recordsArray.Count; j++)
                {
                    if (!TryGetString(recordsArray[j], out string record) || string.IsNullOrWhiteSpace(record))
                        errors.Add($"{prefix}.records[{j}] must be a non-empty string.");
                }
            }
        }

        return names;
    }

    private static void ValidateZoneSetMap(JsonObject root, List<string> errors, HashSet<string> setNames)
    {
        if (!root.TryGetPropertyValue("zoneSetMap", out JsonNode? mapNode) || mapNode is not JsonObject map)
        {
            errors.Add("'zoneSetMap' is required and must be an object.");
            return;
        }

        HashSet<string> seenZones = new(StringComparer.OrdinalIgnoreCase);

        foreach (KeyValuePair<string, JsonNode?> kv in map)
        {
            string prefix = $"zoneSetMap[\"{kv.Key}\"]";

            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add("'zoneSetMap' has an empty key.");
                continue;
            }

            if (!seenZones.Add(kv.Key))
                errors.Add($"{prefix} differs only by case from another zoneSetMap key - the app fails to reload with a case-insensitive duplicate zone.");

            if (kv.Value is not JsonArray sets)
            {
                errors.Add($"{prefix} must be an array of set names.");
                continue;
            }

            for (int i = 0; i < sets.Count; i++)
            {
                if (!TryGetString(sets[i], out string setName) || string.IsNullOrWhiteSpace(setName))
                    errors.Add($"{prefix}[{i}] must be a non-empty string.");
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
}
