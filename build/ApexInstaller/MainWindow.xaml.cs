using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Forms = System.Windows.Forms;

namespace ApexInstaller;

public partial class MainWindow : Window
{
    private const string ProductName = "Apex Files";
    private const string ProductExe = "Apex Files.exe";
    private const string InstallerName = "Apex Files Installer";
    private const string SupportUrl = "https://files.revtechfiles.com/support";

    private enum Step
    {
        Welcome,
        Options,
        Installing,
        Finish,
    }

    private Step _currentStep = Step.Welcome;
    private bool _installRunning;
    private bool _installSucceeded;
    private string? _installedExePath;
    private bool _launchAfterFinish;
    private string? _installLogPath;

    public MainWindow()
    {
        InitializeComponent();
        InstallDirTextBox.Text = GetDefaultInstallDirectory();
        SetStep(Step.Welcome);
    }

    private static string GetDefaultInstallDirectory()
    {
        var baseDir = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrWhiteSpace(baseDir))
        {
            baseDir = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        }

        if (string.IsNullOrWhiteSpace(baseDir))
        {
            baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs");
        }

        return Path.Combine(baseDir, ProductName);
    }

    private void AppendInstallLog(string message)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_installLogPath))
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var logDir = Path.Combine(localAppData, InstallerName);
                Directory.CreateDirectory(logDir);
                _installLogPath = Path.Combine(logDir, "install.log");
            }

            File.AppendAllText(
                _installLogPath!,
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never block setup.
        }
    }

    private void SetStep(Step step)
    {
        _currentStep = step;
        PageWelcome.Visibility = step == Step.Welcome ? Visibility.Visible : Visibility.Collapsed;
        PageOptions.Visibility = step == Step.Options ? Visibility.Visible : Visibility.Collapsed;
        PageInstalling.Visibility = step == Step.Installing ? Visibility.Visible : Visibility.Collapsed;
        PageFinish.Visibility = step == Step.Finish ? Visibility.Visible : Visibility.Collapsed;

        SetStepLabel(StepWelcome, step == Step.Welcome);
        SetStepLabel(StepOptions, step == Step.Options);
        SetStepLabel(StepInstall, step == Step.Installing);
        SetStepLabel(StepFinish, step == Step.Finish);

        BackButton.IsEnabled = step == Step.Options;
        BackButton.Visibility = step == Step.Options ? Visibility.Visible : Visibility.Collapsed;
        CancelButton.Visibility = step == Step.Installing ? Visibility.Collapsed : Visibility.Visible;

        switch (step)
        {
            case Step.Welcome:
                FooterStatusText.Text = "Ready to install";
                NextButton.Content = "Next";
                NextButton.IsEnabled = true;
                break;
            case Step.Options:
                FooterStatusText.Text = "Configure setup options";
                NextButton.Content = "Install";
                NextButton.IsEnabled = true;
                break;
            case Step.Installing:
                FooterStatusText.Text = "Installing...";
                NextButton.Content = "Installing...";
                NextButton.IsEnabled = false;
                break;
            case Step.Finish:
                FooterStatusText.Text = _installSucceeded ? "Installation complete" : "Installation failed";
                NextButton.Content = _installSucceeded ? "Finish" : "Close";
                NextButton.IsEnabled = true;
                break;
        }
    }

    private static void SetStepLabel(TextBlock block, bool active)
    {
        block.Foreground = active
            ? System.Windows.Media.Brushes.White
            : new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x8E, 0x97, 0xAA));
        block.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (_currentStep == Step.Options)
        {
            SetStep(Step.Welcome);
        }
    }

    private async void NextButton_Click(object sender, RoutedEventArgs e)
    {
        if (_currentStep == Step.Welcome)
        {
            SetStep(Step.Options);
            return;
        }

        if (_currentStep == Step.Options)
        {
            await StartInstallAsync();
            return;
        }

        if (_currentStep == Step.Finish)
        {
            if (_installSucceeded && _launchAfterFinish)
            {
                TryLaunchInstalledApp(_installedExePath);
            }
            Close();
        }
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e)
    {
        if (_installRunning) return;
        Close();
    }

    private void BrowseInstallDir_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new Forms.FolderBrowserDialog
        {
            Description = "Select install folder for Apex Files",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
            InitialDirectory = InstallDirTextBox.Text
        };

        if (dialog.ShowDialog() == Forms.DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath))
        {
            InstallDirTextBox.Text = dialog.SelectedPath.Trim();
        }
    }

    private void OpenSupport_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = SupportUrl,
                UseShellExecute = true,
            });
        }
        catch
        {
            // Best effort only.
        }
    }

    private async Task StartInstallAsync()
    {
        if (_installRunning) return;

        var installDir = InstallDirTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(installDir))
        {
            System.Windows.MessageBox.Show(
                "Please choose an installation directory.",
                InstallerName,
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        var payloadDir = ResolvePayloadDir();
        if (payloadDir is null)
        {
            System.Windows.MessageBox.Show(
                "Could not load the embedded Apex Files payload.",
                InstallerName,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            return;
        }

        _installRunning = true;
        _installSucceeded = false;
        SetStep(Step.Installing);
        InstallProgress.Value = 0;
        InstalledFilesList.Items.Clear();
        InstallStatusText.Text = "Preparing files...";
        InstallDetailText.Text = "Checking install directory...";
        AppendInstallLog("Install started.");
        AppendInstallLog($"Install dir: {installDir}");
        AppendInstallLog($"Payload dir: {payloadDir}");

        try
        {
            await EnsureInstallDirectoryUnlockedAsync(installDir);
            await CopyPayloadAsync(payloadDir, installDir);

            _installedExePath = Path.Combine(installDir, ProductExe);
            if (!File.Exists(_installedExePath))
            {
                throw new InvalidOperationException("Installed Apex Files executable was not found after copy.");
            }

            TryOptionalStep("CreateStartMenuShortcut", () => CreateStartMenuShortcut(_installedExePath));

            if (DesktopShortcutCheckbox.IsChecked == true)
            {
                TryOptionalStep("CreateDesktopShortcut", () => CreateDesktopShortcut(_installedExePath));
            }
            else
            {
                TryOptionalStep("RemoveDesktopShortcut", RemoveDesktopShortcut);
            }

            if (StartOnWindowsStartupCheckbox.IsChecked == true)
            {
                TryOptionalStep("CreateStartupShortcut", () => CreateStartupShortcut(_installedExePath));
            }
            else
            {
                TryOptionalStep("RemoveStartupShortcut", RemoveStartupShortcut);
            }

            InstallProgress.Value = 100;
            _installSucceeded = true;
            _launchAfterFinish = LaunchNowCheckbox.IsChecked == true;
            FinishTitle.Text = "Installation complete";
            FinishBody.Text = "Apex Files has been installed successfully.";
            InstallStatusText.Text = "Installation finished successfully.";
            InstallDetailText.Text = "Apex Files is ready to launch.";
            AppendInstallLog("Install finished successfully.");
        }
        catch (Exception ex)
        {
            _installSucceeded = false;
            _launchAfterFinish = false;
            FinishTitle.Text = "Installation failed";
            FinishBody.Text = "Setup did not complete. Check the error below and try again.";
            InstallStatusText.Text = "Installation failed.";
            InstallDetailText.Text = string.IsNullOrWhiteSpace(_installLogPath)
                ? ex.Message
                : $"{ex.Message} (Log: {_installLogPath})";
            AppendInstallLog($"Install failed: {ex}");
        }
        finally
        {
            _installRunning = false;
            SetStep(Step.Finish);
        }
    }

    private async Task EnsureInstallDirectoryUnlockedAsync(string installDir)
    {
        var installRoot = Path.GetFullPath(installDir)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            return;
        }

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.HasExited) continue;
                var exePath = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(exePath)) continue;

                var fullExePath = Path.GetFullPath(exePath);
                var inInstallDir =
                    fullExePath.StartsWith(installRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(fullExePath, Path.Combine(installRoot, ProductExe), StringComparison.OrdinalIgnoreCase);
                if (!inInstallDir) continue;

                AppendInstallLog($"Detected running process in install dir: PID={process.Id}, Name={process.ProcessName}");
                try
                {
                    process.CloseMainWindow();
                }
                catch
                {
                    // Best effort only.
                }

                await Task.Delay(300);
                process.WaitForExit(3000);
                if (!process.HasExited)
                {
                    AppendInstallLog($"Force killing process PID={process.Id}");
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(5000);
                }
            }
            catch (Exception ex)
            {
                AppendInstallLog($"Process lock check warning: {ex.Message}");
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static bool IsFileLockException(Exception ex)
    {
        var io = ex as IOException ?? ex.InnerException as IOException;
        if (io is null) return false;
        const int sharingViolation = unchecked((int)0x80070020);
        const int lockViolation = unchecked((int)0x80070021);
        return io.HResult == sharingViolation || io.HResult == lockViolation;
    }

    private void TryOptionalStep(string stepName, Action action)
    {
        try
        {
            action();
            AppendInstallLog($"{stepName}: OK");
        }
        catch (Exception ex)
        {
            AppendInstallLog($"{stepName}: FAILED - {ex.Message}");
        }
    }

    private async Task CopyPayloadAsync(string sourceRoot, string targetRoot)
    {
        Directory.CreateDirectory(targetRoot);
        var files = Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories);
        if (files.Length == 0)
        {
            throw new InvalidOperationException("Installer payload is empty.");
        }

        long totalBytes = files.Sum(path => new FileInfo(path).Length);
        long copiedBytes = 0;
        int copiedCount = 0;

        foreach (var sourceFile in files)
        {
            var relative = Path.GetRelativePath(sourceRoot, sourceFile);
            var destinationFile = Path.Combine(targetRoot, relative);
            var destinationDir = Path.GetDirectoryName(destinationFile);
            if (!string.IsNullOrWhiteSpace(destinationDir))
            {
                Directory.CreateDirectory(destinationDir);
            }

            const int maxAttempts = 6;
            var copied = false;
            for (var attempt = 1; attempt <= maxAttempts; attempt += 1)
            {
                try
                {
                    await using var input = new FileStream(sourceFile, FileMode.Open, FileAccess.Read, FileShare.Read);
                    await using var output = new FileStream(destinationFile, FileMode.Create, FileAccess.Write, FileShare.None);
                    await input.CopyToAsync(output);
                    copied = true;
                    break;
                }
                catch (Exception ex) when (IsFileLockException(ex) && attempt < maxAttempts)
                {
                    AppendInstallLog($"File lock while copying '{relative}', retry {attempt}/{maxAttempts}: {ex.Message}");
                    await Task.Delay(250 * attempt);
                }
                catch (Exception ex)
                {
                    throw new IOException(
                        $"Failed to copy '{relative}'. Close Apex Files and retry. Details: {ex.Message}",
                        ex);
                }
            }

            if (!copied)
            {
                throw new IOException($"Failed to copy '{relative}' due to a locked file.");
            }

            copiedBytes += new FileInfo(sourceFile).Length;
            copiedCount += 1;

            var percent = totalBytes > 0 ? (double)copiedBytes / totalBytes * 100.0 : 0.0;
            InstallProgress.Value = Math.Max(0, Math.Min(100, percent));
            InstallStatusText.Text = $"Copying files... ({copiedCount}/{files.Length})";
            InstallDetailText.Text = relative;
            InstalledFilesList.Items.Insert(0, relative);
            while (InstalledFilesList.Items.Count > 12)
            {
                InstalledFilesList.Items.RemoveAt(InstalledFilesList.Items.Count - 1);
            }
        }
    }

    private static string? ResolvePayloadDir()
    {
        var embedded = ExtractEmbeddedPayloadToCache();
        if (embedded is not null)
        {
            return embedded;
        }

        var currentDir = AppContext.BaseDirectory;
        var direct = Path.Combine(currentDir, "payload");
        if (Directory.Exists(direct))
        {
            return direct;
        }

        var fallback = Path.Combine(currentDir, "..", "..", "..", "..", "..", "dist", "win-unpacked");
        var normalized = Path.GetFullPath(fallback);
        return Directory.Exists(normalized) ? normalized : null;
    }

    private static string? ExtractEmbeddedPayloadToCache()
    {
        try
        {
            var assembly = Assembly.GetExecutingAssembly();
            var resourceName = assembly
                .GetManifestResourceNames()
                .FirstOrDefault(name => name.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase));

            if (string.IsNullOrWhiteSpace(resourceName))
            {
                return null;
            }

            using var payloadStream = assembly.GetManifestResourceStream(resourceName);
            if (payloadStream is null)
            {
                return null;
            }

            using var payloadBuffer = new MemoryStream();
            payloadStream.CopyTo(payloadBuffer);
            var payloadBytes = payloadBuffer.ToArray();
            if (payloadBytes.Length == 0)
            {
                return null;
            }

            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var cacheRoot = Path.Combine(localAppData, InstallerName, "payload-cache");
            Directory.CreateDirectory(cacheRoot);

            var payloadHash = Convert.ToHexString(SHA256.HashData(payloadBytes)).ToLowerInvariant();
            var extractDir = Path.Combine(cacheRoot, payloadHash);
            var marker = Path.Combine(extractDir, ".ok");
            var expectedExe = Path.Combine(extractDir, ProductExe);

            if (File.Exists(marker) && File.Exists(expectedExe))
            {
                return extractDir;
            }

            if (Directory.Exists(extractDir))
            {
                Directory.Delete(extractDir, true);
            }
            Directory.CreateDirectory(extractDir);

            using var archive = new ZipArchive(new MemoryStream(payloadBytes, writable: false), ZipArchiveMode.Read);
            foreach (var entry in archive.Entries)
            {
                var destinationPath = Path.Combine(extractDir, entry.FullName);
                var destinationDir = Path.GetDirectoryName(destinationPath);
                if (!string.IsNullOrWhiteSpace(destinationDir))
                {
                    Directory.CreateDirectory(destinationDir);
                }

                if (string.IsNullOrEmpty(entry.Name))
                {
                    continue;
                }

                entry.ExtractToFile(destinationPath, overwrite: true);
            }

            File.WriteAllText(marker, "ok");
            return File.Exists(expectedExe) ? extractDir : null;
        }
        catch
        {
            return null;
        }
    }

    private static void CreateStartMenuShortcut(string exePath)
    {
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        var linkPath = Path.Combine(programs, $"{ProductName}.lnk");
        CreateShortcut(linkPath, exePath);
    }

    private static void CreateDesktopShortcut(string exePath)
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var linkPath = Path.Combine(desktop, $"{ProductName}.lnk");
        CreateShortcut(linkPath, exePath);
    }

    private static void RemoveDesktopShortcut()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var linkPath = Path.Combine(desktop, $"{ProductName}.lnk");
            if (File.Exists(linkPath))
            {
                File.Delete(linkPath);
            }
        }
        catch
        {
            // Best effort only.
        }
    }

    private static void CreateStartupShortcut(string exePath)
    {
        var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        var linkPath = Path.Combine(startup, $"{ProductName}.lnk");
        CreateShortcut(linkPath, exePath);
    }

    private static void RemoveStartupShortcut()
    {
        try
        {
            var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var linkPath = Path.Combine(startup, $"{ProductName}.lnk");
            if (File.Exists(linkPath))
            {
                File.Delete(linkPath);
            }
        }
        catch
        {
            // Best effort only.
        }
    }

    private static void CreateShortcut(string shortcutPath, string targetPath)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;

        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetPath;
        shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
        shortcut.IconLocation = targetPath + ",0";
        shortcut.Save();
    }

    private static void TryLaunchInstalledApp(string? exePath)
    {
        if (string.IsNullOrWhiteSpace(exePath)) return;
        if (!File.Exists(exePath)) return;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = true,
            });
        }
        catch
        {
            // Best effort only.
        }
    }
}
