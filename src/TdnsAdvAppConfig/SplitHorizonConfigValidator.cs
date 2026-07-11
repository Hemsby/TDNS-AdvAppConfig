using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

// Structural/type validation for the Split Horizon config document, applied
// before POST /api/splithorizon/config/raw forwards it to the real DNS
// server. Mirrors AdvancedBlockingConfigValidator: just enough to catch
// structural mistakes (wrong types, missing/duplicate names), not a full
// mirror of SplitHorizonApp's own parser (e.g. it doesn't validate that a
// network string is a real IP/CIDR).
public static class SplitHorizonConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalNonNegativeNumber(root, "appPreference", errors);
        ValidateOptionalBool(root, "enableAddressTranslation", errors);

        if (root.TryGetPropertyValue("networks", out JsonNode? networksNode) && networksNode is not null)
        {
            if (networksNode is not JsonObject networksObj)
            {
                errors.Add("'networks' must be an object.");
            }
            else
            {
                foreach (KeyValuePair<string, JsonNode?> kv in networksObj)
                {
                    if (string.IsNullOrWhiteSpace(kv.Key))
                    {
                        errors.Add("'networks' has an empty key.");
                        continue;
                    }

                    ValidateStringArray(kv.Value, $"networks[\"{kv.Key}\"]", errors);
                }
            }
        }

        ValidateOptionalStringMap(root, "domainGroupMap", errors);
        ValidateOptionalStringMap(root, "networkGroupMap", errors);

        if (!root.TryGetPropertyValue("groups", out JsonNode? groupsNode) || groupsNode is null)
            return errors; // 'groups' is optional: address translation is opt-in via enableAddressTranslation

        if (groupsNode is not JsonArray groupsArray)
        {
            errors.Add("'groups' must be an array.");
            return errors;
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
            {
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            }
            else if (!seenNames.Add(name))
            {
                errors.Add($"{prefix}.name \"{name}\" is used by more than one group - duplicate names will silently shadow each other server-side.");
            }

            ValidateOptionalBool(group, "enabled", errors, prefix);
            ValidateOptionalBool(group, "translateReverseLookups", errors, prefix);

            if (!group.TryGetPropertyValue("externalToInternalTranslation", out JsonNode? transNode) || transNode is not JsonObject transObj)
            {
                errors.Add($"{prefix}.externalToInternalTranslation is required and must be an object.");
                continue;
            }

            foreach (KeyValuePair<string, JsonNode?> kv in transObj)
            {
                if (string.IsNullOrWhiteSpace(kv.Key))
                {
                    errors.Add($"{prefix}.externalToInternalTranslation has an empty key.");
                    continue;
                }

                if (!TryGetString(kv.Value, out string internalValue) || string.IsNullOrWhiteSpace(internalValue))
                    errors.Add($"{prefix}.externalToInternalTranslation[\"{kv.Key}\"] must map to a non-empty IP/CIDR string.");
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

    private static void ValidateOptionalBool(JsonObject obj, string field, List<string> errors, string? prefix = null)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"{Label(prefix, field)} must be a boolean.");
    }

    private static void ValidateOptionalNonNegativeNumber(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number)
        {
            errors.Add($"'{field}' must be a number.");
            return;
        }

        if (node!.GetValue<double>() < 0)
            errors.Add($"'{field}' must not be negative.");
    }

    private static void ValidateOptionalStringMap(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonObject mapObj)
        {
            errors.Add($"'{field}' must be an object.");
            return;
        }

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

    private static void ValidateStringArray(JsonNode? node, string label, List<string> errors)
    {
        if (node is not JsonArray array)
        {
            errors.Add($"'{label}' must be an array of strings.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out _))
                errors.Add($"'{label}'[{i}] must be a string.");
        }
    }

    private static string Label(string? prefix, string field) => prefix is null ? $"'{field}'" : $"{prefix}.{field}";
}
