using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class ZoneAliasConfigValidator
{
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
            {
                errors.Add("'appPreference' must be a number.");
            }
            else
            {
                double prefValue = prefNode!.GetValue<double>();
                if (prefValue < 0 || prefValue > 255 || prefValue != Math.Floor(prefValue))
                    errors.Add("'appPreference' must be a whole number between 0 and 255.");
            }
        }

        if (root.TryGetPropertyValue("enableAliasing", out JsonNode? enableNode))
        {
            if (!TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
                errors.Add("'enableAliasing' must be a boolean.");
        }

        ValidateZoneAliases(root, errors);

        return errors;
    }

    private static void ValidateZoneAliases(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("zoneAliases", out JsonNode? mapNode))
            return;

        if (mapNode is not JsonObject map)
        {
            errors.Add("'zoneAliases' must be an object when present - the app fails to reload with a null or non-object value.");
            return;
        }

        HashSet<string> seenAliases = new(StringComparer.OrdinalIgnoreCase);

        foreach (KeyValuePair<string, JsonNode?> kv in map)
        {
            string prefix = $"zoneAliases[\"{kv.Key}\"]";

            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add("'zoneAliases' has an empty zone key.");
                continue;
            }

            if (kv.Value is not JsonArray aliasArray)
            {
                errors.Add($"{prefix} must be an array of alias domain names.");
                continue;
            }

            for (int i = 0; i < aliasArray.Count; i++)
            {
                if (!TryGetString(aliasArray[i], out string alias) || string.IsNullOrWhiteSpace(alias))
                {
                    errors.Add($"{prefix}[{i}] must be a non-empty string.");
                    continue;
                }

                if (!seenAliases.Add(alias))
                    errors.Add($"{prefix}[{i}] (\"{alias}\") is used as an alias more than once in this config - the app fails to reload with any repeated alias, even one reused under a different zone.");
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
