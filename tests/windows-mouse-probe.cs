using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

// Test input is restricted to a visible window belonging to the test app.
internal static class MouseProbe {
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
  static double Number(string value) { return double.Parse(value,CultureInfo.InvariantCulture); }
  static void SendMouse(uint flags) {
    Input item=new Input();item.data.mouse.flags=flags;
    if(SendInput(1,new Input[]{item},Marshal.SizeOf(typeof(Input)))!=1)throw new Exception("Mouse input failed.");
  }
  static Point Target(IntPtr window,Rect rect,string x,string y,double width,double height) {
    Point point=new Point { x=(int)Math.Round(Number(x)*(rect.right-rect.left)/width),y=(int)Math.Round(Number(y)*(rect.bottom-rect.top)/height) };
    if(point.x<0 || point.y<0 || point.x>=rect.right || point.y>=rect.bottom)throw new Exception("Point outside target.");
    if(!ClientToScreen(window,ref point))throw new Exception("Cannot resolve screen coordinates.");
    Check(window,point);
    return point;
  }
  static void Check(IntPtr window,Point point) {
    if(GetAncestor(WindowFromPoint(point),2)!=window)throw new Exception("Target is covered at "+point.x+","+point.y+".");
    IntPtr hit=SendMessage(window,0x84,IntPtr.Zero,new IntPtr(unchecked((point.y&0xffff)<<16 | (point.x&0xffff))));
    if(hit.ToInt64()!=1)throw new Exception("Point is not a native client hit target.");
  }
  static void Move(IntPtr window,Point point) {
    if(!SetCursorPos(point.x,point.y))throw new Exception("Cannot move cursor.");
    Thread.Sleep(100);
    Point actual;GetCursorPos(out actual);
    if(actual.x!=point.x || actual.y!=point.y)throw new Exception("Cursor did not reach target.");
    Check(window,actual);
  }
  public static int Main(string[] args) {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      IntPtr window=new IntPtr(long.Parse(args[0]));
      uint owner;GetWindowThreadProcessId(window,out owner);
      if(owner!=uint.Parse(args[1]) || !IsWindowVisible(window))throw new Exception("Target must be the test app's visible window.");
      Rect rect;if(!GetClientRect(window,out rect))throw new Exception("Missing target bounds.");
      double width=Number(args[4]),height=Number(args[5]);
      Point start=Target(window,rect,args[2],args[3],width,height);
      string action=args.Length>6?args[6]:"click";
      if(action=="check") {Console.WriteLine("CHECKED");return 0;}
      Point end=action=="drag"?Target(window,rect,args[7],args[8],width,height):start;
      Point original;if(!GetCursorPos(out original))throw new Exception("Cannot preserve cursor.");
      bool held=false;
      try {
        Move(window,start);
        SendMouse(2);held=true;
        if(action=="drag") {
          for(int i=1;i<=12;i++) {
            Point step=new Point { x=start.x+(end.x-start.x)*i/12,y=start.y+(end.y-start.y)*i/12 };
            Move(window,step);
          }
        } else Thread.Sleep(50);
        SendMouse(4);held=false;
        Thread.Sleep(100);
      } finally {
        if(held)SendMouse(4);
        SetCursorPos(original.x,original.y);
      }
      Console.WriteLine(action=="drag"?"DRAGGED":"CLICKED");
      return 0;
    } catch(Exception error) {Console.Error.WriteLine(error.Message);return 1;}
  }
}
