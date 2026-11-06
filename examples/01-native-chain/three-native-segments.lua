-- Dorico 5 experiment, tested 2026-11-06. Import native-line-chain.musicxml
-- as a fresh project. In Write mode select the first TWO quarter notes on
-- the Controller staff. Do not run over the supplied completed Dorico examples.
-- Start and End attachment in the Lines panel must both be Rhythmic position.
-- Creates three consecutive two-quarter-note native line objects.
-- Commands were captured with Dorico's own macro recorder.
-- This is a fixed three-segment proof of concept, not a MIDI reader.
-- The 9/8-space endpoint correction was calibrated to this fixture. It can
-- protrude past the right system edge when a join falls at a system break.
local app = DoApp.DoApp()
local heights = {-4, 4, -4, 2}

local function command(s) app:doCommand(s) end
local function height(which, value)
    command('UI.InvokePropertyChangeValue?Type=kHorizontalLine' .. which .. 'Position&Value=int: ' .. value)
end

command('UI.InvokePaletteButton?PaletteIndicatorID=kGenericLinesPanel.linestyle.solidLine&PaletteSectionID=kGenericLinesHorizontalLinePanel&PropertyButton=false&SetOldValue=false&Set=true&UseLocalOverride=0')
command('Edit.FlipItem')
command('Edit.FlipItem')
for i = 1, 3 do
    height('Start', heights[i])
    height('End', heights[i + 1])
    command('UI.InvokePropertyChangeValue?Type=kHorizontalLineHorizontalStartPosition&Value=string: "kStartWithLeftmostNotehead"')
    command('Window.SwitchMode?WindowMode=kEngraveMode')
    command('Edit.PropertiesSetGlobal')
    command('UI.InvokePropertyChangeValue?Type=kHorizontalLineEndDX&Value=string: "9/8"')
    command('UI.InvokePropertyChangeValue?Type=kHorizontalLineEndDY&Value=string: "0"')
    command('Window.SwitchMode?WindowMode=kWriteMode')
    if i < 3 then command('NoteInput.RepeatLast') end
end
