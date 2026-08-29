"use strict";
const {app,BrowserWindow}=require("electron");
const path=require("path");

if(process.env.LINGFRAME_TEST_USER_DATA){
  app.setPath("userData",path.resolve(process.env.LINGFRAME_TEST_USER_DATA));
}
app.commandLine.appendSwitch("disable-gpu");

let hostWindow=null;
app.whenReady().then(async()=>{
  hostWindow=new BrowserWindow({
    show:false,
    width:1280,
    height:900,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  await hostWindow.loadURL("about:blank");
});

app.on("window-all-closed",()=>app.quit());
