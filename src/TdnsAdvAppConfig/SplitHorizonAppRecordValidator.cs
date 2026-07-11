using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

// Structural/type validation for an add-or-overwrite APP record request,
// applied before POST /api/splithorizon/records forwards it to the real DNS
// server. Mirrors the other validators in this project: catches structural
// mistakes, not a full mirror of SplitHorizonApp's own record-data parser
// (e.g. it doesn't validate that a network key is a real CIDR or that an
// address string is a real IP).
public static class SplitHorizonAppRecordValidator
{
    private static readonly string[] ValidClassPaths = ["SplitHorizon.SimpleAddress", "SplitHorizon.SimpleCNAME"];

    public static List<string> Validate(JsonObject req)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        string? classPath = GetString(req, "classPath");
        if (classPath is null || !ValidClassPaths.Contains(classPath))
            errors.Add($"'classPath' must be one of: {string.Join(", ", ValidClassPaths)}.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object mapping network keys to values.");
            return errors;
        }

        if (dataObj.Count == 0)
            errors.Add("'data' must have at least one network entry.");

        bool isAddress = classPath == "SplitHorizon.SimpleAddress";

        foreach (KeyValuePair<string, JsonNode?> kv in dataObj)
        {
            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add("'data' has an empty network key.");
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
                    if (!TryGetString(addresses[i], out string addr) || string.IsNullOrWhiteSpace(addr))
                        errors.Add($"data[\"{kv.Key}\"][{i}] must be a non-empty IP address string.");
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
