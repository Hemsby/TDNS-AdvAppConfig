using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class NoDataAppRecordValidator
{
    public static List<string> Validate(JsonObject req)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object.");
            return errors;
        }

        if (!dataObj.TryGetPropertyValue("blockedTypes", out JsonNode? typesNode) || typesNode is not JsonArray types || types.Count == 0)
        {
            errors.Add("'data.blockedTypes' is required and must be a non-empty array of DNS record type names - the app throws on every query to this record otherwise.");
            return errors;
        }

        for (int i = 0; i < types.Count; i++)
        {
            if (!TryGetString(types[i], out string typeName) || !Enum.TryParse(typeName, true, out DnsResourceRecordType _))
                errors.Add($"data.blockedTypes[{i}] must be a valid DNS record type name (e.g. A, AAAA, ANY) - the app throws mid-query for an unrecognized entry.");
        }

        return errors;
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
