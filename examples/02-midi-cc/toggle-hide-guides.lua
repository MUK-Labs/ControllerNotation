-- Select all guide notes on the Controller staff before running.
-- Toggle only: run once on visible notes; running again will reveal them.
-- Recorded and tested in Dorico 5, 2026-11-06.
local app = DoApp.DoApp()
app:doCommand([[Window.SwitchMode?WindowMode=kEngraveMode]])
app:doCommand([[Edit.PropertiesSetGlobal]])
app:doCommand([[Edit.ToggleHideNotehead]])
app:doCommand([[Edit.ToggleHideStem]])
