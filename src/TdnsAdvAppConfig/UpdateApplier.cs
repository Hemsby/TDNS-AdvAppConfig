using System.Diagnostics;
using System.IO.Compression;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace TdnsAdvAppConfig;

public sealed class UpdateApplier
{
    // Must match install-service.ps1's default -ServiceName. If this process is
    // running as that service, the Updater helper needs to restart it through
    // the Service Control Manager (sc start) rather than launching the exe
    // directly - otherwise the relaunched process would be an unmanaged
    // standalone process while Windows still shows the service as Stopped.
    public const string WindowsServiceName = "TdnsAdvAppConfig";

    // The project's fixed AssemblyName (no override in the csproj, so it's just the project
    // file name) - i.e. what the Linux build's main executable is always actually called.
    // Deriving this from Environment.ProcessPath instead would be wrong: that's the *calling*
    // process's own path, which only coincidentally matches this when the code runs inside
    // the real deployed app - it silently breaks under any other host (tests, a renamed
    // binary, etc.), since a filename mismatch here fails open (skips the permission fix)
    // rather than erroring.
    private const string LinuxExeName = "TdnsAdvAppConfig";


    public async Task<(bool success, string status, string? message)> ApplyAsync(string downloadUrl, string installDir, CancellationToken ct)
    {
        DeploymentKind kind = DeploymentDetector.Detect();

        if (kind == DeploymentKind.Docker)
            return (false, "docker", "Docker deployments update via: docker compose pull && docker compose up -d (run on the host).");

        string stagingDir = Path.Combine(Path.GetTempPath(), "tdns-advappconfig-update-" + Guid.NewGuid());

        try
        {
            Directory.CreateDirectory(stagingDir);

            string zipPath = Path.Combine(stagingDir, "update.zip");
            using (HttpClient http = new HttpClient())
            {
                byte[] data = await http.GetByteArrayAsync(downloadUrl, ct);
                await File.WriteAllBytesAsync(zipPath, data, ct);
            }

            string extractDir = Path.Combine(stagingDir, "extracted");
            ZipFile.ExtractToDirectory(zipPath, extractDir);

            switch (kind)
            {
                case DeploymentKind.Systemd:
                    {
                        // ZipFile.ExtractToDirectory doesn't restore Unix permissions from the
                        // zip - the extracted binary comes out as a plain non-executable file
                        // regardless of what the release zip itself stores. Without this,
                        // systemd fails to exec it (status=203/EXEC) after the restart below.
                        string extractedExe = Path.Combine(extractDir, LinuxExeName);
                        if (!File.Exists(extractedExe))
                        {
                            // Fail loudly rather than silently deploying a build that's missing
                            // its own entry point - a name mismatch here must not fall through
                            // to CopyDirectory and leave the install non-executable.
                            return (false, "error", $"Downloaded release is missing the expected executable ({LinuxExeName}).");
                        }

                        if (OperatingSystem.IsLinux())
                        {
                            File.SetUnixFileMode(extractedExe,
                                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
                                UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                                UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
                        }

                        // Linux allows replacing a running executable's file on disk; the running
                        // process keeps its old inode open until it exits, so no helper is needed.
                        CopyDirectory(extractDir, installDir);
                        ScheduleSelfExit();
                        return (true, "restarting", "Update staged. Restarting now (systemd Restart=always will bring it back up).");
                    }

                case DeploymentKind.Windows:
                    {
                        string updaterExe = Path.Combine(AppContext.BaseDirectory, "TdnsAdvAppConfig.Updater.exe");
                        if (!File.Exists(updaterExe))
                            return (false, "error", "Updater helper (TdnsAdvAppConfig.Updater.exe) was not found next to the main executable.");

                        int pid = Environment.ProcessId;
                        string exeName = Path.GetFileName(Environment.ProcessPath) ?? "TdnsAdvAppConfig.exe";

                        ProcessStartInfo psi = new ProcessStartInfo(updaterExe)
                        {
                            UseShellExecute = false,
                            WorkingDirectory = AppContext.BaseDirectory
                        };
                        psi.ArgumentList.Add(pid.ToString());
                        psi.ArgumentList.Add(extractDir);
                        psi.ArgumentList.Add(installDir);
                        psi.ArgumentList.Add(exeName);

                        if (WindowsServiceHelpers.IsWindowsService())
                        {
                            psi.ArgumentList.Add("--service");
                            psi.ArgumentList.Add(WindowsServiceName);
                        }

                        Process.Start(psi);
                        ScheduleSelfExit();
                        return (true, "restarting", "Update staged. Restarting now via helper process.");
                    }

                default:
                    return (false, "error", "Unknown deployment type.");
            }
        }
        catch (Exception ex)
        {
            // Without this, a failure here (can't reach GitHub, disk full, a file locked by
            // antivirus, etc.) is an unhandled exception. Program.cs has no exception-handling
            // middleware, so ASP.NET Core's default response for that is a bare 500 with an
            // empty body - the client's res.json() then fails with "Unexpected end of JSON
            // input", hiding whatever actually went wrong.
            // stagingDir (including extractDir) must survive a success return - the Windows
            // path hands extractDir to a separately-launched helper process that reads it
            // after this method returns - so cleanup only happens here, not in a finally.
            try { Directory.Delete(stagingDir, recursive: true); } catch { /* best effort */ }
            return (false, "error", ex.Message);
        }
    }

    private static void ScheduleSelfExit()
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(500);
            Environment.Exit(0);
        });
    }

    private static void CopyDirectory(string sourceDir, string destDir)
    {
        foreach (string dir in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(dir.Replace(sourceDir, destDir));

        foreach (string file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            string destFile = file.Replace(sourceDir, destDir);

            // Overwriting destFile directly fails with "Text file busy" on Linux when it's
            // this process's own running executable (open-for-write conflicts with the
            // kernel's deny-write lock on a currently-executing file). Copying to a temp file
            // in the same directory and renaming over it doesn't have that problem: rename()
            // just swaps the directory entry, which the kernel allows even while the old
            // inode is still mapped and executing.
            string tempFile = destFile + ".update-tmp";
            File.Copy(file, tempFile, overwrite: true);

            // File.Copy creates tempFile as a brand-new inode rather than reusing destFile's,
            // so it does NOT inherit destFile's permissions - it gets the umask default
            // instead. Without this, the executable bit is silently stripped from the main
            // binary (and everything else), and systemd fails to exec it after the restart.
            // (CopyDirectory only ever runs for the Systemd deployment path, hence Linux-only.)
            if (OperatingSystem.IsLinux())
                File.SetUnixFileMode(tempFile, File.GetUnixFileMode(file));

            File.Move(tempFile, destFile, overwrite: true);
        }
    }
}
