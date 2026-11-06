-- Select the segments ending at the three new system boundaries, in Engrave mode.
-- Calibrated for the supplied Dorico 5 fixture. Layout-specific.
local app = DoApp.DoApp()
app:doCommand('Window.SwitchMode?WindowMode=kEngraveMode')
app:doCommand('Edit.PropertiesSetGlobal')
app:doCommand('UI.InvokePropertyChangeValue?Type=kHorizontalLineEndDX&Value=string: "7/10"')
