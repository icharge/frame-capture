using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// This process watches modifier state and the exact Win+Shift+S chord only.
// Other keyboard events pass through unchanged; no typed text is stored or emitted.
internal static class ShortcutHost {
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    private static readonly HookProc Callback = OnKeyboard;
    private static readonly bool[] Modifiers = new bool[256];
    private static readonly int[] ModifierKeys = { 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5 };
    private static IntPtr hook;
    private static uint thread;
    private static bool swallowedS;
    private const uint CaptureMessage = 0x8001;

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message {
        public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
        public uint time; public Point point; public uint privateData;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard {
        public ushort key, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Mouse {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] private struct InputData {
        [FieldOffset(0)] public Keyboard keyboard;
        [FieldOffset(0)] public Mouse mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint type; public InputData data; }

    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    private static void MaskStartMenu() {
        // An unassigned key tells the shell Win was used as a modifier even
        // though S is suppressed. This avoids opening Start on Win release.
        Input down = new Input(); down.type = 1; down.data.keyboard.key = 0xe8;
        Input up = down; up.data.keyboard.flags = 2;
        SendInput(2, new Input[] { down, up }, Marshal.SizeOf(typeof(Input)));
    }
    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data) {
        if (code < 0) return CallNextHookEx(hook, code, message, data);
        int kind = message.ToInt32();
        bool down = kind == 0x100 || kind == 0x104;
        bool up = kind == 0x101 || kind == 0x105;
        if (!down && !up) return CallNextHookEx(hook, code, message, data);
        int key = Marshal.ReadInt32(data);
        if (key == 0x5b || key == 0x5c || (key >= 0xa0 && key <= 0xa5))
            Modifiers[key] = down;
        if (key == 0x53) {
            if (up && swallowedS) { swallowedS = false; return new IntPtr(1); }
            if (down && swallowedS) return new IntPtr(1);
            bool win = Modifiers[0x5b] || Modifiers[0x5c];
            bool shift = Modifiers[0xa0] || Modifiers[0xa1];
            bool other = Modifiers[0xa2] || Modifiers[0xa3] || Modifiers[0xa4] || Modifiers[0xa5];
            if (down && win && shift && !other) {
                swallowedS = true;
                MaskStartMenu();
                PostThreadMessage(thread, CaptureMessage, UIntPtr.Zero, IntPtr.Zero);
                return new IntPtr(1);
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }
    private static void EmitCapture(object ignored) {
        try { Console.Out.WriteLine("CAPTURE"); Console.Out.Flush(); }
        catch { PostThreadMessage(thread, 0x12, UIntPtr.Zero, IntPtr.Zero); }
    }
    public static int Main(string[] args) {
        int parentId;
        if (args.Length != 1 || !int.TryParse(args[0], out parentId)) return 1;
        Process parent;
        try { parent = Process.GetProcessById(parentId); }
        catch { return 1; }
        thread = GetCurrentThreadId();
        Message message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create this thread's message queue.
        foreach (int key in ModifierKeys) Modifiers[key] = GetAsyncKeyState(key) < 0;
        hook = SetWindowsHookEx(13, Callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.Out.WriteLine("ERROR"); return 1; }
        try {
            // Watch the process handle: inherited pipe handles can delay EOF after a crash.
            Thread owner = new Thread(delegate() {
                try { parent.WaitForExit(); }
                catch { }
                finally { PostThreadMessage(thread, 0x12, UIntPtr.Zero, IntPtr.Zero); }
            });
            owner.IsBackground = true; owner.Start();
            // EOF supports the normal disable path as well.

            Thread input = new Thread(delegate() {
                try { while (Console.ReadLine() != null) {} }
                finally { PostThreadMessage(thread, 0x12, UIntPtr.Zero, IntPtr.Zero); }
            });
            input.IsBackground = true; input.Start();
            Console.Out.WriteLine("READY"); Console.Out.Flush();
            int result;
            while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0) {
                if (message.message == CaptureMessage)
                    ThreadPool.QueueUserWorkItem(EmitCapture);
            }
            return result < 0 ? 1 : 0;
        } finally { UnhookWindowsHookEx(hook); parent.Dispose(); GC.KeepAlive(Callback); }
    }
}
