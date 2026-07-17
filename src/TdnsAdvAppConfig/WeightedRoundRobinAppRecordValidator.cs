using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class WeightedRoundRobinAppRecordValidator
{
    public const string ClassPathAddress = "WeightedRoundRobin.Address";
    public const string ClassPathCname = "WeightedRoundRobin.CNAME";

    public static List<string> Validate(JsonObject req)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        string? classPath = GetString(req, "classPath");
        bool isAddress = classPath == ClassPathAddress;
        bool isCname = classPath == ClassPathCname;
        if (!isAddress && !isCname)
            errors.Add($"'classPath' must be one of: {ClassPathAddress}, {ClassPathCname}.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object.");
            return errors;
        }

        if (isCname)
        {
            bool hasCnames = ValidateWeightedList(dataObj, "cnames", "domain", isAddressField: false, errors);

            if (!hasCnames)
                errors.Add("'cnames' must have at least one entry.");
        }
        else if (isAddress)
        {
            bool hasIpv4 = ValidateWeightedList(dataObj, "ipv4Addresses", "address", isAddressField: true, errors);
            bool hasIpv6 = ValidateWeightedList(dataObj, "ipv6Addresses", "address", isAddressField: true, errors);

            if (!hasIpv4 && !hasIpv6)
                errors.Add("At least one of 'ipv4Addresses' or 'ipv6Addresses' must have at least one entry.");
        }

        return errors;
    }

    private static bool ValidateWeightedList(JsonObject dataObj, string listField, string valueField, bool isAddressField, List<string> errors)
    {
        if (!dataObj.TryGetPropertyValue(listField, out JsonNode? node) || node is null)
            return false;

        if (node is not JsonArray array)
        {
            errors.Add($"'{listField}' must be an array - the app throws on every matching query otherwise (including a present null of the wrong type).");
            return false;
        }

        int validEntries = 0;

        for (int i = 0; i < array.Count; i++)
        {
            if (array[i] is not JsonObject entry)
            {
                errors.Add($"{listField}[{i}] must be an object.");
                continue;
            }

            bool entryValid = true;

            if (!entry.TryGetPropertyValue(valueField, out JsonNode? valueNode) || !TryGetString(valueNode, out string value) || string.IsNullOrWhiteSpace(value))
            {
                errors.Add($"{listField}[{i}].{valueField} is required and must be a non-empty string - the app throws mid-query for a present non-string value.");
                entryValid = false;
            }
            else if (isAddressField && !IPAddress.TryParse(value, out _))
            {
                errors.Add($"{listField}[{i}].{valueField} must be a valid IP address - an unparseable one is silently never selected by the app, so it can never take effect.");
                entryValid = false;
            }

            if (!entry.TryGetPropertyValue("weight", out JsonNode? weightNode) || !TryGetScalarKind(weightNode, out JsonValueKind weightKind) || weightKind != JsonValueKind.Number || !weightNode!.GetValue<JsonElement>().TryGetInt32(out int weight) || weight < 1)
            {
                errors.Add($"{listField}[{i}].weight is required and must be a whole number of at least 1 - the app throws mid-query for a present non-integer value, and silently never selects an entry weighted below 1.");
                entryValid = false;
            }

            if (entry.TryGetPropertyValue("enabled", out JsonNode? enabledNode) && enabledNode is not null && (!TryGetScalarKind(enabledNode, out JsonValueKind enabledKind) || (enabledKind != JsonValueKind.True && enabledKind != JsonValueKind.False)))
            {
                errors.Add($"{listField}[{i}].enabled must be a boolean when present - the app throws mid-query otherwise.");
                entryValid = false;
            }

            if (entryValid)
                validEntries++;
        }

        return validEntries > 0;
    }

    private static string? GetString(JsonObject obj, string field)
    {
        return obj.TryGetPropertyValue(field, out JsonNode? node) && TryGetString(node, out string value) ? value : null;
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
