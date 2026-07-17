using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class LogExporterConfigValidator
{
    private static readonly string[] ValidSyslogProtocols = ["udp", "tcp", "tls", "local"];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateNonNullableInt(root, "maxQueueSize", errors);

        ValidateFileTarget(root, errors);
        ValidateHttpTarget(root, errors);
        ValidateSyslogTarget(root, errors);

        return errors;
    }

    private static void ValidateFileTarget(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("file", out JsonNode? node) || node is not JsonObject file)
        {
            errors.Add("'file' is required and must be an object - the app throws on every reload (NullReferenceException) if it's missing or null, even while disabled.");
            return;
        }

        ValidateOptionalBool(file, "enabled", "file", errors);

        if (!file.TryGetPropertyValue("path", out JsonNode? pathNode) || !TryGetString(pathNode, out string path) || string.IsNullOrWhiteSpace(path))
            errors.Add("'file.path' is required and must be a non-empty string - required unconditionally by the app even while disabled.");
    }

    private static void ValidateHttpTarget(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("http", out JsonNode? node) || node is not JsonObject http)
        {
            errors.Add("'http' is required and must be an object - the app throws on every reload (NullReferenceException) if it's missing or null, even while disabled.");
            return;
        }

        ValidateOptionalBool(http, "enabled", "http", errors);

        if (!http.TryGetPropertyValue("endpoint", out JsonNode? endpointNode) || !TryGetString(endpointNode, out string endpoint) || string.IsNullOrWhiteSpace(endpoint) || !Uri.TryCreate(endpoint, UriKind.Absolute, out _))
            errors.Add("'http.endpoint' is required and must be a valid absolute URL - required unconditionally by the app even while disabled.");

        if (!http.TryGetPropertyValue("headers", out JsonNode? headersNode) || headersNode is null)
            return;

        if (headersNode is not JsonObject headersObj)
        {
            errors.Add("'http.headers' must be an object when present.");
            return;
        }

        foreach (KeyValuePair<string, JsonNode?> kv in headersObj)
        {
            if (!IsValidHttpHeaderName(kv.Key))
                errors.Add($"http.headers[\"{kv.Key}\"] is not a valid HTTP header name - the app throws on reload for an invalid one.");

            if (kv.Value is not null && !TryGetString(kv.Value, out _))
                errors.Add($"http.headers[\"{kv.Key}\"] must be a string or null.");
        }
    }

    private static void ValidateSyslogTarget(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("syslog", out JsonNode? node) || node is not JsonObject syslog)
        {
            errors.Add("'syslog' is required and must be an object - the app throws on every reload (NullReferenceException) if it's missing or null, even while disabled.");
            return;
        }

        ValidateOptionalBool(syslog, "enabled", "syslog", errors);

        string protocol = "udp";
        if (syslog.TryGetPropertyValue("protocol", out JsonNode? protocolNode) && protocolNode is not null)
        {
            if (!TryGetString(protocolNode, out protocol) || !ValidSyslogProtocols.Contains(protocol.ToLowerInvariant()))
                errors.Add("'syslog.protocol' must be one of: udp, tcp, tls, local - the app throws on reload for anything else.");
        }

        if (!syslog.TryGetPropertyValue("address", out JsonNode? addressNode) || !TryGetString(addressNode, out string address))
        {
            errors.Add("'syslog.address' is required and must be a string - required unconditionally by the app even while disabled or using the 'local' protocol.");
        }
        else if (string.IsNullOrWhiteSpace(address) && !protocol.Equals("local", StringComparison.OrdinalIgnoreCase))
        {
            errors.Add("'syslog.address' must be non-empty for the udp/tcp/tls protocols.");
        }

        ValidateOptionalNullableInt(syslog, "port", errors);
    }

    private static bool IsValidHttpHeaderName(string name)
    {
        if (name.Length == 0)
            return false;

        foreach (char c in name)
        {
            bool isTokenChar = char.IsAsciiLetterOrDigit(c) || "!#$%&'*+-.^_`|~".IndexOf(c) >= 0;
            if (!isTokenChar)
                return false;
        }

        return true;
    }

    private static void ValidateOptionalBool(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"'{prefix}.{field}' must be a boolean - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateNonNullableInt(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out int value) || value < 0)
            errors.Add($"'{field}' must be a non-negative whole number - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateOptionalNullableInt(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out int value) || value < 1 || value > 65535)
            errors.Add($"'{field}' must be a port number between 1 and 65535 when present.");
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
