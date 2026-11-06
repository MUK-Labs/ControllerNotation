-- Select all pasted contour lines. Restores ordinary-join end offsets.
-- Calibrated for the supplied Dorico 5 fixture. Layout-specific.
local app = DoApp.DoApp()
app:doCommand('Window.SwitchMode?WindowMode=kEngraveMode')
app:doCommand('Edit.PropertiesSetGlobal')
app:doCommand('UI.InvokePropertyChangeValue?Type=kHorizontalLineEndDX&Value=string: "9/8"')
