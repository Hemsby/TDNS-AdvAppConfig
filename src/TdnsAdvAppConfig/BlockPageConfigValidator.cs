using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class BlockPageConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonArray profiles)
        {
            errors.Add("Config must be a JSON array of web server profiles.");
            return errors;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < profiles.Count; i++)
        {
            string prefix = $"[{i}]";

            if (profiles[i] is not JsonObject profile)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (profile.TryGetPropertyValue("name", out JsonNode? nameNode) && nameNode is not null)
            {
                if (!TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                    errors.Add($"{prefix}.name must be a non-empty string when present.");
                else if (!seenNames.Add(name))
                    errors.Add($"{prefix}.name \"{name}\" is used by more than one profile - the app re-initializes the same named web server with each entry in order, so only the last one actually takes effect.");
            }

            ValidateOptionalBool(profile, "enableWebServer", errors, prefix);
            ValidateOptionalBool(profile, "webServerUseSelfSignedTlsCertificate", errors, prefix);
            ValidateOptionalBool(profile, "webServerEnableOnlineCertificateSigning", errors, prefix);
            ValidateOptionalBool(profile, "includeBlockingInfo", errors, prefix);

            if (!profile.TryGetPropertyValue("webServerLocalAddresses", out JsonNode? addrsNode) || addrsNode is not JsonArray addrsArray)
            {
                errors.Add($"{prefix}.webServerLocalAddresses is required and must be an array of IP addresses.");
            }
            else
            {
                for (int j = 0; j < addrsArray.Count; j++)
                {
                    if (!TryGetString(addrsArray[j], out string addr) || !IPAddress.TryParse(addr, out _))
                        errors.Add($"{prefix}.webServerLocalAddresses[{j}] must be a valid IP address - the app fails to reload with an unparseable address.");
                }
            }

            ValidateRequiredNullableString(profile, "webServerTlsCertificateFilePath", errors, prefix);
            ValidateRequiredNullableString(profile, "webServerTlsCertificatePassword", errors, prefix);
            ValidateRequiredNullableString(profile, "blockPageTitle", errors, prefix);
            ValidateRequiredNullableString(profile, "blockPageHeading", errors, prefix);
            ValidateRequiredNullableString(profile, "blockPageMessage", errors, prefix);

            if (!profile.TryGetPropertyValue("webServerRootPath", out JsonNode? rootPathNode) || !TryGetString(rootPathNode, out string rootPath) || string.IsNullOrEmpty(rootPath))
                errors.Add($"{prefix}.webServerRootPath is required and must be a non-empty string.");

            if (!profile.TryGetPropertyValue("serveBlockPageFromWebServerRoot", out JsonNode? serveNode) || !TryGetScalarKind(serveNode, out JsonValueKind serveKind) || (serveKind != JsonValueKind.True && serveKind != JsonValueKind.False))
                errors.Add($"{prefix}.serveBlockPageFromWebServerRoot is required and must be a boolean.");
        }

        return errors;
    }

    private static void ValidateRequiredNullableString(JsonObject profile, string field, List<string> errors, string prefix)
    {
        if (!profile.TryGetPropertyValue(field, out JsonNode? node))
        {
            errors.Add($"{prefix}.{field} is required (may be null, but the key must be present).");
            return;
        }

        if (node is not null && !TryGetString(node, out _))
            errors.Add($"{prefix}.{field} must be a string or null.");
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

    private static void ValidateOptionalBool(JsonObject obj, string field, List<string> errors, string prefix)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"{prefix}.{field} must be a boolean.");
    }
}
