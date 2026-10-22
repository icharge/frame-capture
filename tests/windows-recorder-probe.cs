using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

// Test-only input, restricted to an owned, visible Frame recorder window.
// Coordinates are scaled from the renderer viewport to the physical client area.
internal static class RecorderProbe {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct Data { [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Data data; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr value,IntPtr data);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] inputs,int size);
  static void Click(Input input) {
    if(SendInput(1,new Input[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new Exception("Mouse input failed.");
  }
  public static int Main(string[] args) {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      IntPtr window=new IntPtr(long.Parse(args[0]));
      uint owner;GetWindowThreadProcessId(window,out owner);
      if(owner!=uint.Parse(args[1]) || !IsWindowVisible(window))throw new Exception("Target must be the test app's visible recorder.");
      Rect rect;if(!GetClientRect(window,out rect))throw new Exception("Missing target bounds.");
      Point point=new Point {
        x=(int)Math.Round(double.Parse(args[2],CultureInfo.InvariantCulture)*(rect.right-rect.left)/double.Parse(args[4],CultureInfo.InvariantCulture)),
        y=(int)Math.Round(double.Parse(args[3],CultureInfo.InvariantCulture)*(rect.bottom-rect.top)/double.Parse(args[5],CultureInfo.InvariantCulture))
      };
      if(point.x<0 || point.y<0 || point.x>=rect.right || point.y>=rect.bottom)throw new Exception("Point outside recorder.");
      ClientToScreen(window,ref point);
      if(GetAncestor(WindowFromPoint(point),2)!=window)throw new Exception("Recorder is covered by another window.");
      IntPtr hit=SendMessage(window,0x84,IntPtr.Zero,new IntPtr(unchecked((point.y&0xffff)<<16 | (point.x&0xffff))));
      if(hit.ToInt64()!=1)throw new Exception("Button is not a native client hit target.");
      Point original;if(!GetCursorPos(out original))throw new Exception("Cannot preserve cursor.");
      Input down=new Input(),up=new Input();
      down.data.mouse.flags=2;up.data.mouse.flags=4;
      bool held=false;
      try {
        if(!SetCursorPos(point.x,point.y))throw new Exception("Cannot move cursor.");
        Thread.Sleep(150);
        Point actual;GetCursorPos(out actual);
        if(actual.x!=point.x || actual.y!=point.y || GetAncestor(WindowFromPoint(actual),2)!=window)
          throw new Exception("Recorder is not under the cursor.");
        Click(down);held=true;
        Thread.Sleep(50);
        Click(up);held=false;
        Thread.Sleep(100);
      } finally {
        if(held)Click(up);
        SetCursorPos(original.x,original.y);
      }
      Console.WriteLine("CLICKED");
      return 0;
    } catch(Exception error) {Console.Error.WriteLine(error.Message);return 1;}
  }
}
