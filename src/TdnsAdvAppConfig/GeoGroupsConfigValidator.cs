using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class GeoGroupsConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (!root.TryGetPropertyValue("groups", out JsonNode? groupsNode))
            return errors;

        if (groupsNode is not JsonObject groupsObj)
        {
            errors.Add("'groups' must be an object - a missing key is fine, but a present null or any other type crashes the app on reload.");
            return errors;
        }

        foreach (KeyValuePair<string, JsonNode?> kv in groupsObj)
        {
            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add("'groups' has an empty key.");
                continue;
            }

            if (kv.Value is not JsonArray entries)
            {
                errors.Add($"groups[\"{kv.Key}\"] must be an array of continent/country codes or ASNs.");
                continue;
            }

            for (int i = 0; i < entries.Count; i++)
            {
                if (!TryGetString(entries[i], out string value) || string.IsNullOrWhiteSpace(value))
                    errors.Add($"groups[\"{kv.Key}\"][{i}] must be a non-empty string.");
            }
        }

        return errors;
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
