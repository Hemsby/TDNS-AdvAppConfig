using System.Diagnostics;

// Windows-only helper: the main app's exe is locked while it runs, so it can't
// overwrite itself. This process waits for the main process to exit, copies the
// staged update over the install directory, then relaunches the main app -
// either directly, or through the Service Control Manager if it was running
// as a Windows Service (a raw Process.Start would otherwise orphan it from
// the SCM, which would keep showing the service as Stopped).
//
// args: <mainPid> <stagingDir> <installDir> <exeName> [--service <serviceName>]

if (args.Length < 4)
{
    Console.Error.WriteLine("Usage: TdnsAdvAppConfig.Updater <mainPid> <stagingDir> <installDir> <exeName> [--service <serviceName>]");
    return 1;
}

int pid = int.Parse(args[0]);
string stagingDir = args[1];
string installDir = args[2];
string exeName = args[3];
string? serviceName = (args.Length >= 6 && args[4] == "--service") ? args[5] : null;

for (int i = 0; i < 60; i++)
{
    try
    {
        Process.GetProcessById(pid);
        Thread.Sleep(500);
    }
    catch (ArgumentException)
    {
        break; // main process has exited
    }
}

Thread.Sleep(1000); // give the OS a moment to fully release file handles

foreach (string file in Directory.GetFiles(stagingDir, "*", SearchOption.AllDirectories))
{
    string dest = Path.Combine(installDir, Path.GetRelativePath(stagingDir, file));
    string? destDir = Path.GetDirectoryName(dest);
    if (destDir is not null)
        Directory.CreateDirectory(destDir);

    for (int attempt = 0; attempt < 10; attempt++)
    {
        try
        {
            File.Copy(file, dest, overwrite: true);
            break;
        }
        catch (IOException) when (attempt < 9)
        {
            Thread.Sleep(500);
        }
    }
}

if (serviceName is not null)
{
    // The SCM already tracked the old process as this service and saw it
    // exit; "sc start" launches a fresh instance through the SCM properly,
    // rather than a Process.Start that the SCM would know nothing about.
    Process.Start(new ProcessStartInfo("sc.exe", $"start {serviceName}")
    {
        UseShellExecute = false,
        WorkingDirectory = installDir
    });
}
else
{
    string exePath = Path.Combine(installDir, exeName);
    Process.Start(new ProcessStartInfo(exePath)
    {
        UseShellExecute = true,
        WorkingDirectory = installDir
    });
}

return 0;
