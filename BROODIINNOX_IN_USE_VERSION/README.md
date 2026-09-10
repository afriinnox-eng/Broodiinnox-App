# BROODIINNOX_IN_USE_VERSION

Firmware versions of the Broodiinnox controller that are (or were) actually flashed
onto shipped/bench units. One folder per version, each folder a complete Arduino
sketch — this keeps the hardware code independent from the web app
(`src/`, `broodiinnox-api/`) in the same repository.

| Version | Sketch | Status |
| --- | --- | --- |
| BROODIINNOX_12 | [`BROODIINNOX_12/BROODIINNOX_12.ino`](BROODIINNOX_12/BROODIINNOX_12.ino) | **In use** — current released firmware |

## BROODIINNOX_12

The same ESP32 firmware as the earlier `BROODIINNOX_V11.ino`, plus the fixes made
while bringing the bench unit up on the real modem and network. Behaviour, MQTT
protocol, LCD menu and topics are unchanged, so devices already running V11 talk to
the same backend and dashboard after this update.

### What changed compared with V11

1. **Modem UART pins corrected** — `MODEM_TX 17` / `MODEM_RX 16` (previously `TX 16`
   / `RX 17`). With the old order the TX/RX direction was reversed against the board
   wiring, so `Serial1` was receive-on-17 / transmit-on-16 and the modem never
   answered on the AT bus at all. `Serial1` must receive on GPIO16 and transmit on
   GPIO17.
2. **Task-watchdog budget raised to 120 s** — `esp_task_wdt_reconfigure()` with
   `timeout_ms = 120000`, `trigger_panic = true`, `idle_core_mask = 0x03`
   (`esp_task_wdt.h` / `esp_idf_version.h` added). The Arduino core starts the TWDT
   before `setup()`, so `esp_task_wdt_init()` only logs "TWDT already initialized"
   and leaves the 5 s default in place; `reconfigure()` is the call that actually
   changes a running watchdog. Without it a modem recovery pass (CIPSHUT timeout +
   power-cycle + init retries + `waitForNetwork`) holds core 0 past 5 s, starves
   IDLE0 and panic-reboots the unit in a loop.
3. **Deterministic modem power-on at boot** — the modem rail is switched **off**
   first (`modemPowerOff()`, 500 ms) before `modemPowerOn()`. `modemPowerOn()` pulses
   PWKEY *toggling* the modem's power state, and an ESP32-only reset does not always
   cut the modem's supply, so booting with the modem still powered used to switch it
   off instead — presenting as a permanent "MODEM FAILED".
4. **Remote restart command** — subscribes to
   `BROODIINNOX/<DEVICE_ID>/control/restart`; on `RESTART` it powers the modem down,
   waits 300 ms and reboots the ESP32, so the next boot starts from a known modem
   state. Ignored while the subscription lock (`device_locked`) is set.
5. `DEVICE_ID` is `BROODIINNOX-001` (was `BROODIINNOX-002` in the shared V11 file), and
   `topic_restart` is built alongside the other control topics.

Nothing else in the sketch was modified — the changelog list in the file header,
the control topics, the weekly-reduction logic and the NVS layout are as in V11.

### Hardware

- ESP32 dev board (bench unit: ESP32-D0WD-V3, `3c:8a:1f:ae:9f:6c`)
- Cellular modem on `Serial1` (RX = GPIO16, TX = GPIO17), powered from GPIO12,
  reset GPIO5 — SIM7600 AT set (bench modem: SIMCOM A7670C-LNNV)
- Up to 4 × DS18B20 temperature sensors on OneWire
- DS3231 RTC over I²C
- 20×4 I²C LCD + 4 buttons (SELECT / BACK / UP / DOWN)
- Heat-lamp relay

### Libraries

`TinyGSM` (SIM7600 driver), `PubSubClient`, `ArduinoJson`, `RTClib`, `OneWire`,
`DallasTemperature`, `LiquidCrystal_I2C`, plus the bundled `WiFi` / `WebServer` /
`Preferences` ESP32 core libraries.

### Build and upload (arduino-cli)

```
arduino-cli compile --fqbn esp32:esp32:esp32 BROODIINNOX_12
arduino-cli upload  --fqbn esp32:esp32:esp32 -p COM4 --upload-property upload.speed=921600 BROODIINNOX_12
```

The exact `BROODIINNOX_12.ino` committed here is the file that was compiled and
flashed on the bench unit (it is byte-identical to the build copy that was verified
against the live device).
