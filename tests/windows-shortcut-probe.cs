using System;
using System.Runtime.InteropServices;
using System.Threading;

// Test-only hook installed BEFORE Frame. If Frame suppresses the chord, this
// hook never receives S. Otherwise it consumes S to avoid launching system UI.
internal static class ShortcutProbe {
  private delegate IntPtr Proc(int code, IntPtr message, IntPtr data);
  private static readonly Proc Callback = Observe;
  private static IntPtr hook;
  private static uint thread;
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint extra; }
  [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] private struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] private struct Data { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] private struct Input { public uint type; public Data data; }
  [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int type, Proc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr value, IntPtr data);
  [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  private static Input Key(ushort key,bool up) { Input input=new Input();input.type=1;input.data.keyboard.key=key;input.data.keyboard.flags=up?2u:0u;return input; }
  private static void Send(int variant) {
    ushort win=variant==2?(ushort)0x5c:(ushort)0x5b, shift=variant==2?(ushort)0xa1:(ushort)0xa0;
    Input[] keys;
    if(variant==3) keys=new Input[]{Key(0x53,false),Key(0x53,true)};
    else if(variant==4) keys=new Input[]{Key(0xa2,false),Key(0xa0,false),Key(0x53,false),Key(0x53,true),Key(0xa0,true),Key(0xa2,true)};
    else keys=new Input[]{Key(win,false),Key(shift,false),Key(0x53,false),Key(0x53,false),Key(0x53,true),Key(shift,true),Key(win,true)};
    uint sent=SendInput((uint)keys.Length,keys,Marshal.SizeOf(typeof(Input)));
    Console.WriteLine(sent==(uint)keys.Length?"SENT":"ERROR");
  }
  private static IntPtr Observe(int code,IntPtr message,IntPtr data) {
    if(code>=0 && (Marshal.ReadInt32(data,8)&0x10)!=0 && Marshal.ReadInt32(data)==0x53) {
      int kind=message.ToInt32();
      bool down=kind==0x100||kind==0x104;
      if(down) { Input[] mask={Key(0xe8,false),Key(0xe8,true)};SendInput(2,mask,Marshal.SizeOf(typeof(Input))); }
      PostThreadMessage(thread,0x8002,new UIntPtr(down?1u:0u),IntPtr.Zero);
      return new IntPtr(1);
    }
    return CallNextHookEx(hook,code,message,data);
  }
  public static int Main() {
    thread=GetCurrentThreadId(); Message message;PeekMessage(out message,IntPtr.Zero,0,0,0);
    hook=SetWindowsHookEx(13,Callback,GetModuleHandle(null),0);
    if(hook==IntPtr.Zero)return 1;
    Thread input=new Thread(delegate(){string line;while((line=Console.ReadLine())!=null){int variant;if(int.TryParse(line,out variant))PostThreadMessage(thread,0x8001,new UIntPtr((uint)variant),IntPtr.Zero);}PostThreadMessage(thread,0x12,UIntPtr.Zero,IntPtr.Zero);});
    input.IsBackground=true;input.Start();Console.WriteLine("READY");
    try { while(GetMessage(out message,IntPtr.Zero,0,0)>0) {
      if(message.message==0x8001)Send((int)message.wParam.ToUInt32());
      if(message.message==0x8002)Console.WriteLine(message.wParam.ToUInt32()==1?"S_DOWN":"S_UP");
    }} finally {UnhookWindowsHookEx(hook);GC.KeepAlive(Callback);}
    return 0;
  }
}
