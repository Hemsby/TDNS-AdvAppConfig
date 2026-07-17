using System.Net;
using System.Net.Sockets;

namespace TdnsAdvAppConfig;

public static class NetworkAddressHelper
{
    public static bool TryParse(string network, out IPAddress? address, out int prefixLength)
    {
        address = null;
        prefixLength = 0;

        string[] parts = network.Split('/', 2);

        if (!IPAddress.TryParse(parts[0], out IPAddress? parsedAddress))
            return false;

        int maxPrefixLength = parsedAddress.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;

        if (parts.Length == 1)
        {
            address = parsedAddress;
            prefixLength = maxPrefixLength;
            return true;
        }

        if (!int.TryParse(parts[1], out int parsedPrefixLength) || parsedPrefixLength < 0 || parsedPrefixLength > maxPrefixLength)
            return false;

        address = parsedAddress;
        prefixLength = parsedPrefixLength;
        return true;
    }
}
