using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class GeoAppRecordValidator
{
    public static List<string> Validate(JsonObject req, string classPathAddress, string classPathCname)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        string? classPath = GetString(req, "classPath");
        if (classPath != classPathAddress && classPath != classPathCname)
            errors.Add($"'classPath' must be one of: {classPathAddress}, {classPathCname}.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object mapping continent/country codes, ASNs, group names, or 'default' to a response.");
            return errors;
        }

        if (dataObj.Count == 0)
            errors.Add("'data' must have at least one entry.");

        bool isAddress = classPath == classPathAddress;

        foreach (KeyValuePair<string, JsonNode?> kv in dataObj)
        {
            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add("'data' has an empty key.");
                continue;
            }

            if (isAddress)
            {
                if (kv.Value is not JsonArray addresses || addresses.Count == 0)
                {
                    errors.Add($"data[\"{kv.Key}\"] must be a non-empty array of IP addresses.");
                    continue;
                }

                for (int i = 0; i < addresses.Count; i++)
                {
                    if (!TryGetString(addresses[i], out string addr) || !IPAddress.TryParse(addr, out _))
                        errors.Add($"data[\"{kv.Key}\"][{i}] must be a valid IP address - the app throws mid-query for an unparseable entry.");
                }
            }
            else
            {
                if (!TryGetString(kv.Value, out string target) || string.IsNullOrWhiteSpace(target))
                    errors.Add($"data[\"{kv.Key}\"] must be a non-empty CNAME target string.");
            }
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
