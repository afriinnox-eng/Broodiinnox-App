/*******************************************************
 * BROODIINNOX SMART BROODING SYSTEM (GSM + MQTT)
 * ESP32 + DS18B20 + DS3231 RTC + LCD + Preferences + SIM7600
 * Author: Muyirama Sezerano Liven
 * Updated: Jan 2026
 *
 * -----------------------------------------------------
 * WHAT THIS DEVICE DOES
 * -----------------------------------------------------
 * BROODIINNOX is an automated incubator/brooder controller. It reads up
 * to 4 DS18B20 temperature sensors, averages the enabled ones, and
 * switches a heat-lamp relay on/off to keep the brooding box between a
 * min and max temperature target. Targets automatically step down each
 * week to match the animal's age ("weekly reduction"), matching common
 * brooding practice. All settings are shown/adjusted on a 20x4 LCD with
 * 4 buttons, and mirrored to a remote MQTT dashboard over the cellular
 * (SIM7600) network so it can be monitored/controlled from anywhere.
 *
 * -----------------------------------------------------
 * HOW IT RUNS (ARCHITECTURE)
 * -----------------------------------------------------
 * Three FreeRTOS tasks run in parallel, protected by mutexes so they
 * never corrupt shared data or the LCD/MQTT connection at the same time:
 *   - SensorControlTask : reads sensors, computes averages, detects
 *     errors/failsafe, drives the relay, applies weekly reduction,
 *     saves settings to NVS periodically.
 *   - DisplayTask        : reads the 4 buttons, updates the LCD menu.
 *   - MQTTTask            : keeps the GSM/MQTT link alive, publishes
 *     sensor data + status + heartbeat, reconnects on drop, and
 *     silently power-cycles ONLY the SIM7600 modem (never the ESP32)
 *     if the cellular link gets stuck.
 * The Arduino loop() itself is otherwise idle - it's only used to
 * service the WiFi config-portal hotspot described below.
 *
 * -----------------------------------------------------
 * LCD MENU (button-cycled with SELECT / BACK, adjusted with UP / DOWN)
 * -----------------------------------------------------
 *   Screen 0 - Main status: day counter, time, average temp, heater
 *              state, error flags, network status.
 *   Screen 1 - Max temperature target (adjustable).
 *   Screen 2 - Min temperature target (adjustable).
 *   Screen 3 - Total brooding days (adjustable).
 *   Screen 4 - Brooding start month (adjustable).
 *   Screen 5 - Brooding start day (adjustable).
 *   Screen 6 - Brooding start year (adjustable).
 *   Screen 7 - Live readout of all 4 individual sensor temperatures.
 *   Screen 8 - Per-sensor enable/disable (DS1-DS4 on/off).
 *   Screen 9 - WiFi config hotspot on/off (see below).
 * Holding SELECT + BACK together for 5s opens the Factory Reset menu
 * (pick an animal preset: Chicken/Pig/Turkey/Duck, which resets max/min
 * temp, total days, weekly reduction rules and clears NVS).
 *
 * -----------------------------------------------------
 * WIFI CONFIG HOTSPOT (screen 9) - "BROODIINNOX-Setup"
 * -----------------------------------------------------
 * Lets you reconfigure the device without re-flashing it:
 *   - On screen 9, press UP to turn the hotspot ON (SSID
 *     "BROODIINNOX-Setup", password "brood1234"), DOWN to turn it OFF.
 *   - Connect a phone/laptop to that WiFi and open 192.168.4.1 to reach
 *     a small web page where you can change the MQTT broker address
 *     and/or set the RTC date & time manually.
 *   - Pressing "Save & Restart" on that page saves the broker to NVS,
 *     applies the time if given, and reboots the device (which also
 *     shuts the hotspot down).
 *   - If left on with no activity, the hotspot auto-turns-off after
 *     5 minutes so it's never accidentally left running.
 * This is entirely separate from the SIM7600 cellular link - WiFi and
 * GSM run independently, so the hotspot never interferes with normal
 * MQTT operation over cellular.
 *
 * -----------------------------------------------------
 * REMOTE TIME SYNC
 * -----------------------------------------------------
 * The RTC (DS3231) can be set three ways:
 *   1. Automatically from the cellular network at boot (AT+CCLK?
 *      through the SIM7600, ~15s after network registration).
 *   2. Manually via the WiFi config hotspot's web page.
 *   3. Remotely over MQTT: publish a time value to
 *      "BROODIINNOX/<DEVICE_ID>/control/set_time" - either a unix
 *      epoch timestamp (e.g. "1754400600") or a text date/time
 *      ("2026-08-05 14:30:00" or "2026-08-05T14:30:00").
 *
 * -----------------------------------------------------
 * MQTT TOPICS (device ID defaults to "BROODIINNOX-001")
 * -----------------------------------------------------
 *   Publishes:
 *     .../data                     full sensor + state snapshot
 *     .../status                   lightweight status (also LWT)
 *   Subscribes (control):
 *     .../control/relay            "ON" | "OFF" | "AUTO"
 *     .../control/max_temp         integer, deg C
 *     .../control/min_temp         integer, deg C
 *     .../control/total_days       integer
 *     .../control/sensor           "DS1:ON" / "DS1:OFF" (etc, DS1-DS4)
 *     .../control/factory_reset    "RESET"
 *     .../control/animal_preset    "Chicken" | "Pig" | "Turkey" | "Duck"
 *     .../control/device_active    "LOCKED" | "ACTIVE" (subscription kill switch)
 *     .../control/set_time         unix epoch or "YYYY-MM-DD HH:MM:SS"
 *
 * -----------------------------------------------------
 * SAFETY / RELIABILITY FEATURES
 * -----------------------------------------------------
 *   - Failsafe mode: if all enabled sensors fail or none are found,
 *     the heater is forced ON (better to overheat briefly than let
 *     chicks freeze) and the LCD/buzzer alarm activates.
 *   - Sensor mismatch detection: flags when readings disagree sharply,
 *     without stopping control.
 *   - Subscription lock ("device_locked"): remotely disables all
 *     control/output (relay, alarm, buttons) if a subscription lapses,
 *     without needing to physically access the device.
 *   - All key settings persist in NVS (Preferences) and survive power
 *     loss / reboot; weekly reduction resumes from where it left off.
 *   - Silent GSM self-healing: if the cellular/MQTT link gets stuck,
 *     only the SIM7600 modem is power-cycled and re-registered in the
 *     background (MQTTTask), while sensors/relay/LCD keep running
 *     without interruption and WITHOUT rebooting the ESP32.
 *
 * CHANGES IN THIS VERSION:
 *  + Fixed RTC time sync using AT+CCLK? through TinyGSM
 *  + Uses direct AT command like working version but keeps TinyGSM
 *  + Proper power sequence and network time activation
 *  + 15-second delay after network registration for clock sync
 *  + Reliable parsing of +CCLK: response
 *  + Loading screen during startup
 *  + Online/Offline status monitoring via MQTT
 *  + New screen 9: WiFi config hotspot to set MQTT broker / RTC time
 *  + New MQTT topic control/set_time for remote RTC updates
 *  + NEW: Silent, modem-only auto-recovery (restartGSMSoft()) - no
 *    more full device reboots when the cellular link gets stuck; the
 *    SIM7600 is power-cycled and reconnected on its own in the
 *    background while the rest of the system keeps running normally.
 *******************************************************/

#define TINY_GSM_MODEM_SIM7600
#define TINY_GSM_RX_BUFFER 1024
#define SerialMon Serial
#define SerialAT  Serial1
#define TINY_GSM_DEBUG SerialMon
#define GSM_PIN ""

#include <Arduino.h>
#include "esp_task_wdt.h"
#include "esp_idf_version.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <RTClib.h>
#include <Preferences.h>
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WebServer.h>

// Uncomment to dump raw AT commands to Serial Monitor
// #define DUMP_AT_COMMANDS

// ========================================================
//                  SIM7600 PINS (FROM WORKING AT EXAMPLE)
// ========================================================
#define MODEM_RESET_PIN   5
#define MODEM_PWKEY       2
#define MODEM_POWER_ON   12
// TX/RX CORRECTED for this build: the earlier pin assignment had these two
// swapped against the board wiring (UART direction reversed), which kept
// the SIM7600 from ever answering on the AT bus. The modem is wired with
// its TXD to GPIO16 and RXD to GPIO17, so the ESP32 must receive on 16
// and transmit on 17.
#define MODEM_TX         17
#define MODEM_RX         16
#define MODEM_RESET_LEVEL HIGH
#define BUILTIN_LED       4

// ========================================================
//                  NETWORK CONFIG
// ========================================================
const char apn[]          = "internet";   // <-- change to your SIM APN
const char gprsUser[]     = "";
const char gprsPass[]     = "";

// mqtt_broker is now a mutable buffer (was a const char*) so it can be changed
// from the hotspot config portal and persisted in NVS. Default value below is
// used the first time the device boots, or if NVS has no saved value yet.
char        mqtt_broker_buf[64] = "broker.hivemq.com"; //broker.hivemq.com  /test.mosquitto.org
const int   mqtt_port     = 1883;
const char* mqtt_username = "";
const char* mqtt_password = "";

// ========================================================
//                  MODEM / MQTT OBJECTS
// ========================================================
#ifdef DUMP_AT_COMMANDS
  #include <StreamDebugger.h>
  StreamDebugger debugger(SerialAT, SerialMon);
  TinyGsm modem(debugger);
#else
  TinyGsm modem(SerialAT);
#endif

TinyGsmClient gsmClient(modem);
PubSubClient  mqttClient(gsmClient);

// ========================================================
//                  DEVICE IDENTITY
// ========================================================
const String DEVICE_ID   = "BROODIINNOX-001";
const String DEVICE_NAME = "BROODIINNOX";

// ========================================================
//                  MQTT TOPICS
// ========================================================
String topic_data           = "BROODIINNOX/" + DEVICE_ID + "/data";
String topic_relay          = "BROODIINNOX/" + DEVICE_ID + "/control/relay";
String topic_max_temp       = "BROODIINNOX/" + DEVICE_ID + "/control/max_temp";
String topic_min_temp       = "BROODIINNOX/" + DEVICE_ID + "/control/min_temp";
String topic_total_days     = "BROODIINNOX/" + DEVICE_ID + "/control/total_days";
String topic_sensor_control = "BROODIINNOX/" + DEVICE_ID + "/control/sensor";
String topic_status         = "BROODIINNOX/" + DEVICE_ID + "/status";
String topic_factory_reset  = "BROODIINNOX/" + DEVICE_ID + "/control/factory_reset";
String topic_animal_preset  = "BROODIINNOX/" + DEVICE_ID + "/control/animal_preset";
String topic_device_active  = "BROODIINNOX/" + DEVICE_ID + "/control/device_active";
String topic_set_time       = "BROODIINNOX/" + DEVICE_ID + "/control/set_time";
String topic_restart        = "BROODIINNOX/" + DEVICE_ID + "/control/restart";

// ========================================================
//                  PIN DEFINITIONS
// ========================================================
#define UP            18
#define DOWN          19
#define BACK          33
#define SELECT        13
#define ONE_WIRE_BUS  15
#define ALARM          4
#define RELAY         27

// ========================================================
//                  DS18B20
// ========================================================
OneWire           oneWire(ONE_WIRE_BUS);
DallasTemperature sensorsDS18B20(&oneWire);

DeviceAddress sensorAddresses[4];
bool          sensorFound[4] = {false, false, false, false};

volatile int sensorsDetectedCount     = 0;
const unsigned long SENSOR_RETRY_INTERVAL = 30000UL;

// ========================================================
//                  SETTINGS / DEFAULTS
// ========================================================
volatile int total_days       = 30;
volatile int day              = 1;
volatile int max_temp         = 36;
volatile int min_temp         = 32;
volatile int screen           = 0;
volatile int starting_year    = 2025;
volatile int starting_month   = 10;
volatile int starting_day_val = 11;
volatile int selected_sensor_display = 1;

bool lastUpState     = HIGH, lastDownState  = HIGH;
bool lastSelectState = HIGH, lastBackState  = HIGH;

bool relay_state          = false;
bool manual_relay_control = false;
bool s1 = true, s2 = true, s3 = true, s4 = true;

// Shared temperature data — always access under dataMutex
float temp1 = NAN, temp2 = NAN, temp3 = NAN, temp4 = NAN;
float ave_temp = NAN;

bool   sensorError   = false;
bool   mismatchError = false;
bool   failsafe_mode = false;
String errorMsg      = "";

unsigned long previousAlarmMillis = 0;
const unsigned long alarmInterval = 500;
bool alarmState = false;

int  lastReductionDay       = 0;
bool weekly_reduce_enabled  = true;
int  weekly_reduce_deg      = 3;
int  weekly_max_floor       = 28;
int  weekly_min_floor       = 18;
int  weekly_min_deadband    = 3;

bool      factory_reset_mode    = false;
bool      factory_reset_confirm = false;
int       selected_animal    = 0;
const int ANIMAL_COUNT       = 4;
String    animal_names[]     = {"Chicken", "Pig", "Turkey", "Duck"};
const unsigned long FACTORY_RESET_HOLD_TIME = 5000;

// ========================================================
//                  SUBSCRIPTION LOCK
// ========================================================
bool device_locked = false;

// ========================================================
//                  HOTSPOT / WIFI CONFIG PORTAL
// ========================================================
// Screen 9 (after the sensor on/off screen) lets the user turn a WiFi
// hotspot ON, connect to it with a phone/laptop, and open a small web
// page to change the MQTT broker address and/or set the RTC time
// manually. Saving on that page restarts the device (which also turns
// the hotspot off). If left on with no activity, it auto-shuts-off
// after HOTSPOT_TIMEOUT_MS so it isn't left running by accident.
WebServer     configServer(80);
bool          hotspot_active     = false;
unsigned long hotspotStartMillis = 0;
const unsigned long HOTSPOT_TIMEOUT_MS = 5UL * 60UL * 1000UL; // 5 minutes
const char*   HOTSPOT_SSID = "BROODIINNOX-Setup";
const char*   HOTSPOT_PASS = "brood1234"; // must be >= 8 chars for WPA2
bool          hotspot_restart_pending = false;
unsigned long hotspot_restart_at_ms   = 0;

// ========================================================
//                  GSM / MQTT STATE
// ========================================================
bool  gsm_initialized    = false;
bool  mqtt_connected     = false;
int   gsm_signal_quality = 0;

unsigned long lastMqttPublish   = 0;
unsigned long lastMqttReconnect = 0;
const unsigned long MQTT_PUBLISH_INTERVAL   = 5000;
const unsigned long MQTT_RECONNECT_INTERVAL = 15000;

// --------------------------------------------------------
//  Silent GSM self-healing state (modem-only restart, no ESP reboot)
// --------------------------------------------------------
// After this many consecutive failed MQTT reconnect attempts (roughly
// GSM_RESTART_FAIL_THRESHOLD * MQTT_RECONNECT_INTERVAL of being down),
// MQTTTask stops just retrying MQTT and instead power-cycles the SIM7600
// modem itself via restartGSMSoft(). Sensors/relay/LCD are completely
// unaffected because they live in other tasks and never touch the modem.
int                 mqttReconnectFailCount   = 0;
const int           GSM_RESTART_FAIL_THRESHOLD = 3;

// Even when mqttClient.connected() reports true, the underlying radio
// link can occasionally die silently (stale TCP socket). This periodic
// check catches that case too.
unsigned long       lastGsmHealthCheck        = 0;
const unsigned long GSM_HEALTH_CHECK_INTERVAL = 120000UL; // 2 minutes

// ========================================================
//                  HEARTBEAT / ONLINE STATUS
// ========================================================
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 30000;

// --------------------------------------------------------
//  Pending-publish queue
// --------------------------------------------------------
volatile bool pendingPublishStatus = false;

// ========================================================
//                  SENSOR EVENT FLAGS
// ========================================================
enum SensorEvent {
  SEVENT_NONE = 0,
  SEVENT_NO_SENSORS,
  SEVENT_RECOVERED
};
volatile SensorEvent pendingSensorEvent = SEVENT_NONE;

// ========================================================
//                  ANIMAL PRESETS
// ========================================================
struct AnimalSettings {
  String name;
  int max_temp, min_temp, total_days;
  bool weekly_reduce;
  int weekly_reduce_deg, max_temp_floor, min_temp_floor, min_deadband;
};

AnimalSettings animal_defaults[] = {
  {"Chicken", 36, 32, 30, true, 3, 28, 18, 3},
  {"Pig",     34, 30, 45, true, 2, 26, 20, 3},
  {"Turkey",  37, 33, 28, true, 3, 29, 18, 3},
  {"Duck",    35, 31, 35, true, 2, 27, 18, 3}
};

// ========================================================
//                  HARDWARE OBJECTS
// ========================================================
LiquidCrystal_I2C lcd(0x27, 20, 4);
RTC_DS3231        rtc;
DateTime          startDate;
Preferences       prefs;

// ========================================================
//                  CUSTOM LCD ICONS (home screen, top-right)
// ========================================================
// Small 5x8 custom characters used as a quick-glance network status icon
// in the top-right corner of the Home screen, in addition to the existing
// text status on line 3. Loaded into the LCD's CGRAM once in setup().
#define ICON_NET_OK  0   // signal bars - GSM + MQTT both connected
#define ICON_NET_BAD 1   // "x" - no GSM signal and/or MQTT not connected

byte iconNetOk[8] = {
  B00001,
  B00001,
  B00101,
  B00101,
  B10101,
  B10101,
  B10101,
  B00000
};

byte iconNetBad[8] = {
  B00000,
  B10001,
  B01010,
  B00100,
  B01010,
  B10001,
  B00000,
  B00000
};

// ========================================================
//                  RTOS HANDLES
// ========================================================
TaskHandle_t SensorControlTaskHandle = NULL;
TaskHandle_t DisplayTaskHandle       = NULL;
TaskHandle_t MQTTTaskHandle          = NULL;

SemaphoreHandle_t lcdMutex  = NULL;
SemaphoreHandle_t dataMutex = NULL;
SemaphoreHandle_t mqttMutex = NULL;

// ========================================================
//                  DISPLAY STATE
// ========================================================
unsigned long lastDisplayUpdate = 0;
const unsigned long DISPLAY_INTERVAL = 500;
int    currentDisplayScreen = -1;
String displayBuffer[4]     = {"", "", "", ""};

const unsigned long SAVE_INTERVAL_MS = 30000;

// ========================================================
//                  LOADING SCREEN STATE
// ========================================================
bool setupComplete = false;
int loadingProgress = 0;

// ========================================================
//                  FORWARD DECLARATIONS
// ========================================================
void load_data();
void save_data(bool force = false);
void compute_temperature_average();
void check_sensor_errors();
bool all_active_sensors_failed();
void check_and_control_relay();
void remaining_days();
void handle_alarm();
void handle_buttons_nonblocking();
void update_main_screen();
void update_line(int line, const String& content);
void update_network_icon();
void SensorControlTask(void* pvParameters);
void DisplayTask(void* pvParameters);
void MQTTTask(void* pvParameters);
void apply_weekly_reduction_if_needed();
void apply_weekly_temp_reduction();
void check_factory_reset();
void enter_factory_reset_mode();
void exit_factory_reset_mode();
void perform_factory_reset(int animalIndex = 0);
void apply_animal_settings(int idx);
void show_factory_reset_screen();
void showLCD(const String& l1, const String& l2,
             const String& l3, const String& l4);
void discoverDS18B20Sensors();
void readDS18B20Temperatures();
bool setup_gsm();
bool mqttConnect();
bool restartGSMSoft();     // NEW: silent, modem-only restart (no ESP.restart())
void mqtt_callback(char* topic, byte* payload, unsigned int length);
void safe_publish_sensor_data();
void safe_publish_status();
void safe_publish_online_status(bool online);
bool updateRTCFromGSM();   // Uses AT+CCLK? through TinyGSM (reliable method)
void modemPowerOn();       // Power sequence from working AT example
void modemPowerOff();      // Clean modem shutdown before ESP.restart()/soft restart
void updateLoadingScreen(int progress);
void startHotspot();
void stopHotspot();
void setupConfigServerRoutes();

// ========================================================
//                  MODEM POWER ON (FROM WORKING AT EXAMPLE)
// ========================================================
void modemPowerOn()
{
  pinMode(MODEM_POWER_ON, OUTPUT);
  digitalWrite(MODEM_POWER_ON, HIGH);
  delay(1000);

  pinMode(MODEM_RESET_PIN, OUTPUT);

  digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);
  delay(100);

  digitalWrite(MODEM_RESET_PIN, MODEM_RESET_LEVEL);
  delay(2600);

  digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);

  pinMode(MODEM_PWKEY, OUTPUT);

  digitalWrite(MODEM_PWKEY, LOW);
  delay(100);

  digitalWrite(MODEM_PWKEY, HIGH);
  delay(1000);

  digitalWrite(MODEM_PWKEY, LOW);

  delay(8000); // Important: wait for modem to be ready
}

// ========================================================
//                  MODEM POWER OFF (clean shutdown before restart)
// ========================================================
// IMPORTANT: ESP.restart() only resets the ESP32 chip - it does NOT
// power-cycle the SIM7600 modem. If the modem is already powered on
// when we call modemPowerOn() again on the next boot, pulsing PWKEY
// toggles the modem's power state rather than switching it "on" - so
// it can actually turn the modem OFF, leaving it dead until someone
// presses the external reset button (which cuts power to everything,
// including the modem, forcing a clean start).
//
// To avoid needing that physical reset, we explicitly cut power to the
// modem here (MODEM_POWER_ON LOW) before every ESP.restart() in this
// sketch, so the next boot always starts from a known, fully-off modem
// state and modemPowerOn() behaves consistently. This same function is
// reused by restartGSMSoft() below to power-cycle the modem WITHOUT
// rebooting the ESP32.
void modemPowerOff()
{
  SerialMon.println("Powering down modem...");
  digitalWrite(MODEM_PWKEY, LOW);
  digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);
  digitalWrite(MODEM_POWER_ON, LOW); // cut the modem's power rail
  delay(1500); // let it fully discharge before power-on / ESP restart
}

// ========================================================
//                  UPDATE RTC FROM GSM (USING AT+CCLK? THROUGH TINYGSM)
//                  This is the RELIABLE method - same as working AT version
// ========================================================
bool updateRTCFromGSM()
{
  SerialMon.println("\n=== GETTING GSM TIME USING AT+CCLK? ===");
  
  // Send AT command to get network time using TinyGSM
  // This is the SAME command that works in the AT version
  modem.sendAT("+CCLK?");
  
  // Wait for response - use the response string directly
  String response = "";
  if (modem.waitResponse(3000L, response) != 1) {
    SerialMon.println("ERROR: No response to AT+CCLK?");
    return false;
  }
  
  SerialMon.println("Raw response: " + response);
  
  // Find the +CCLK: response
  int startIndex = response.indexOf("+CCLK:");
  if (startIndex == -1) {
    SerialMon.println("ERROR: +CCLK: not found in response");
    return false;
  }
  
  // Find the quoted string (same as working AT version)
  int quoteStart = response.indexOf("\"", startIndex);
  if (quoteStart == -1) {
    SerialMon.println("ERROR: Quote not found");
    return false;
  }
  
  int quoteEnd = response.indexOf("\"", quoteStart + 1);
  if (quoteEnd == -1) {
    SerialMon.println("ERROR: Closing quote not found");
    return false;
  }
  
  // Extract the time string (same as working AT version)
  String timeStr = response.substring(quoteStart + 1, quoteEnd);
  SerialMon.println("Time string: " + timeStr);
  
  // Parse format: YY/MM/DD,HH:MM:SS+TZ
  // Example: 26/07/17,15:30:20+08
  int year, month, day, hour, minute, second;
  
  // Parse using sscanf (same as working AT version)
  if (sscanf(timeStr.c_str(), "%2d/%2d/%2d,%2d:%2d:%2d",
             &year, &month, &day, &hour, &minute, &second) == 6) {
    
    year += 2000; // Convert YY to YYYY
    
    SerialMon.printf("Parsed time: %04d/%02d/%02d %02d:%02d:%02d\n",
                     year, month, day, hour, minute, second);
    
    // Update RTC
    rtc.adjust(DateTime(year, month, day, hour, minute, second));
    SerialMon.println("RTC UPDATED FROM GSM");
    
    return true;
  } else {
    SerialMon.println("ERROR: Failed to parse time string");
    return false;
  }
}

// ========================================================
//                  LCD HELPERS
// ========================================================
void showLCD(const String& l1, const String& l2,
             const String& l3, const String& l4) {
  if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(300))) {
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print(l1.substring(0, 20));
    if (l2.length()) { lcd.setCursor(0, 1); lcd.print(l2.substring(0, 20)); }
    if (l3.length()) { lcd.setCursor(0, 2); lcd.print(l3.substring(0, 20)); }
    if (l4.length()) { lcd.setCursor(0, 3); lcd.print(l4.substring(0, 20)); }
    for (int i = 0; i < 4; i++) displayBuffer[i] = "";
    xSemaphoreGive(lcdMutex);
  }
}

void update_line(int line, const String& content) {
  if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(100))) {
    if (displayBuffer[line] != content) {
      String p = content.substring(0, 20);
      while ((int)p.length() < 20) p += ' ';
      lcd.setCursor(0, line);
      lcd.print(p);
      displayBuffer[line] = content;
    }
    xSemaphoreGive(lcdMutex);
  }
}

// Draws a small connectivity icon in the top-right corner (column 19, row 0)
// of the Home screen: signal bars when GSM + MQTT are both up, an "x" when
// either is down. This is purely a quick-glance indicator - the detailed
// NOGM/NO4G/4G text status on line 3 of the Home screen is unchanged. While
// restartGSMSoft() is silently recovering the modem in the background, this
// icon will simply keep showing "x" (same as any other transient drop) -
// there is no separate "restarting" indicator, exactly like a phone
// re-registering with the tower.
void update_network_icon() {
  bool netOk = gsm_initialized && mqtt_connected;
  if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(100))) {
    lcd.setCursor(19, 0);
    lcd.write(byte(netOk ? ICON_NET_OK : ICON_NET_BAD));
    xSemaphoreGive(lcdMutex);
  }
}

// ========================================================
//                  LOADING SCREEN
// ========================================================
void updateLoadingScreen(int progress) {
  if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(300))) {
    lcd.clear();
    
    lcd.setCursor(0, 0);
    lcd.print("BROODIINNOX LOADING");
    
    lcd.setCursor(0, 1);
    lcd.print("|");
    int barLength = 18;
    int filled = (progress * barLength) / 100;
    for (int i = 0; i < barLength; i++) {
      if (i < filled) lcd.print("=");
      else lcd.print(" ");
    }
    lcd.print("|");
    
    lcd.setCursor(0, 2);
    char progressStr[21];
    snprintf(progressStr, sizeof(progressStr), "  %d%% COMPLETE  ", progress);
    lcd.print(progressStr);
    
    lcd.setCursor(0, 3);
    lcd.print(DEVICE_ID.substring(0, 20));
    
    for (int i = 0; i < 4; i++) displayBuffer[i] = "";
    xSemaphoreGive(lcdMutex);
  }
}

// ========================================================
//                  HOTSPOT / WIFI CONFIG PORTAL
// ========================================================
void setupConfigServerRoutes() {
  configServer.on("/", HTTP_GET, []() {
    hotspotStartMillis = millis(); // any activity resets the auto-off timer

    String html =
      "<!DOCTYPE html><html><head><title>BROODIINNOX Setup</title>"
      "<meta name='viewport' content='width=device-width, initial-scale=1'>"
      "<style>body{font-family:sans-serif;margin:20px;background:#111;color:#eee}"
      "input{width:100%;padding:8px;margin:6px 0;box-sizing:border-box;"
      "border:1px solid #444;background:#222;color:#eee;border-radius:4px}"
      "label{font-size:14px;color:#aaa}"
      "button{padding:12px 20px;background:#e67e22;border:none;color:#fff;"
      "border-radius:4px;font-size:16px;width:100%;margin-top:10px}"
      "h2{color:#e67e22}</style></head><body>"
      "<h2>BROODIINNOX Setup - " + DEVICE_ID + "</h2>"
      "<form action='/save' method='POST'>"
      "<label>MQTT Broker Address</label>"
      "<input name='broker' value='" + String(mqtt_broker_buf) + "'>"
      "<label>Set Date &amp; Time (leave blank to keep current)</label>"
      "<input type='datetime-local' name='dt'>"
      "<button type='submit'>Save &amp; Restart</button>"
      "</form>"
      "<p style='color:#777;font-size:12px'>The hotspot turns off automatically "
      "after 5 minutes of inactivity if you don't save.</p>"
      "</body></html>";

    configServer.send(200, "text/html", html);
  });

  configServer.on("/save", HTTP_POST, []() {
    hotspotStartMillis = millis();

    if (configServer.hasArg("broker")) {
      String b = configServer.arg("broker");
      b.trim();
      if (b.length() > 0 && b.length() < sizeof(mqtt_broker_buf)) {
        b.toCharArray(mqtt_broker_buf, sizeof(mqtt_broker_buf));
        prefs.begin("settings", false);
        prefs.putString("mqtt_broker", b);
        prefs.end();
        SerialMon.println("Broker updated via hotspot portal: " + b);
      }
    }

    if (configServer.hasArg("dt")) {
      String dt = configServer.arg("dt"); // format: YYYY-MM-DDTHH:MM
      if (dt.length() >= 16) {
        int y  = dt.substring(0, 4).toInt();
        int mo = dt.substring(5, 7).toInt();
        int d  = dt.substring(8, 10).toInt();
        int h  = dt.substring(11, 13).toInt();
        int mi = dt.substring(14, 16).toInt();
        if (y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          rtc.adjust(DateTime(y, mo, d, h, mi, 0));
          SerialMon.println("RTC manually set via hotspot portal");
        }
      }
    }

    configServer.send(200, "text/html",
      "<!DOCTYPE html><html><head><meta name='viewport' "
      "content='width=device-width, initial-scale=1'></head>"
      "<body style='font-family:sans-serif;text-align:center;margin-top:60px;"
      "background:#111;color:#eee'>"
      "<h2>Saved!</h2><p>The device is restarting now...</p></body></html>");

    // Give the HTTP response time to actually leave the device before reboot.
    hotspot_restart_pending = true;
    hotspot_restart_at_ms   = millis() + 1500;
  });
}

void startHotspot() {
  if (hotspot_active) return;
  SerialMon.println("Starting config hotspot...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(HOTSPOT_SSID, HOTSPOT_PASS);
  setupConfigServerRoutes();
  configServer.begin();
  hotspot_active          = true;
  hotspot_restart_pending = false;
  hotspotStartMillis      = millis();
  currentDisplayScreen    = -1; // force screen redraw to show IP
  SerialMon.println("Hotspot SSID: " + String(HOTSPOT_SSID));
  SerialMon.println("Hotspot IP  : " + WiFi.softAPIP().toString());
}

void stopHotspot() {
  if (!hotspot_active) return;
  SerialMon.println("Stopping config hotspot...");
  configServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  hotspot_active          = false;
  hotspot_restart_pending = false;
  currentDisplayScreen    = -1; // force screen redraw
}

// ========================================================
//                  SAFE MQTT PUBLISH
// ========================================================
void safe_publish_sensor_data() {
  if (!mqtt_connected || !gsm_initialized) return;

  float t1, t2, t3, t4, av;
  bool  se, me, fm;
  if (!xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) return;
  t1 = temp1; t2 = temp2; t3 = temp3; t4 = temp4;
  av = ave_temp;
  se = sensorError; me = mismatchError; fm = failsafe_mode;
  xSemaphoreGive(dataMutex);

  StaticJsonDocument<600> doc;
  doc["device_id"]          = DEVICE_ID;
  doc["device_name"]        = DEVICE_NAME;
  doc["timestamp"]          = rtc.now().unixtime();
  doc["day"]                = day;
  doc["total_days"]         = total_days;
  doc["max_temp"]           = max_temp;
  doc["min_temp"]           = min_temp;
  doc["ave_temp"]           = isnan(av) ? -999.0f : av;
  doc["relay_state"]        = relay_state;
  doc["manual_control"]     = manual_relay_control;
  doc["failsafe_mode"]      = fm;
  doc["sensor_error"]       = se;
  doc["mismatch_error"]     = me;
  doc["signal_quality"]     = gsm_signal_quality;
  doc["device_locked"]      = device_locked;
  if (!isnan(t1)) doc["sensor1"] = t1;
  if (!isnan(t2)) doc["sensor2"] = t2;
  if (!isnan(t3)) doc["sensor3"] = t3;
  if (!isnan(t4)) doc["sensor4"] = t4;
  doc["s1_enabled"]              = s1;
  doc["s2_enabled"]              = s2;
  doc["s3_enabled"]              = s3;
  doc["s4_enabled"]              = s4;
  doc["weekly_reduce_enabled"]   = weekly_reduce_enabled;
  doc["weekly_reduce_deg"]       = weekly_reduce_deg;
  doc["last_reduction_day"]      = lastReductionDay;
  if (errorMsg.length()) doc["error"] = errorMsg;

  char buf[600];
  size_t n = serializeJson(doc, buf);

  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(2000))) {
    bool ok = mqttClient.publish(topic_data.c_str(), (const uint8_t*)buf, n);
    xSemaphoreGive(mqttMutex);
    if (!ok) {
      SerialMon.println("MQTT: data publish FAILED");
      mqtt_connected = false;
    }
  }
}

void safe_publish_status() {
  if (!mqtt_connected || !gsm_initialized) return;

  float av;
  if (!xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) return;
  av = ave_temp;
  xSemaphoreGive(dataMutex);

  StaticJsonDocument<300> doc;
  doc["device_id"]      = DEVICE_ID;
  doc["status"]         = device_locked ? "locked" : "online";
  doc["device_locked"]  = device_locked;
  doc["relay_state"]    = relay_state ? "ON" : "OFF";
  doc["manual_control"] = manual_relay_control ? "MANUAL" : "AUTO";
  doc["day"]            = day;
  doc["total_days"]     = total_days;
  doc["max_temp"]       = max_temp;
  doc["min_temp"]       = min_temp;
  doc["ave_temp"]       = isnan(av) ? -999.0f : av;
  doc["failsafe"]       = failsafe_mode;
  doc["signal_quality"] = gsm_signal_quality;

  char buf[300];
  size_t n = serializeJson(doc, buf);

  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(2000))) {
    bool ok = mqttClient.publish(topic_status.c_str(), (const uint8_t*)buf, n);
    xSemaphoreGive(mqttMutex);
    if (!ok) {
      SerialMon.println("MQTT: status publish FAILED");
      mqtt_connected = false;
    }
  }
}

// ========================================================
//                  ONLINE STATUS PUBLISH (HEARTBEAT)
// ========================================================
void safe_publish_online_status(bool online) {
  if (!mqtt_connected || !gsm_initialized) return;

  String statusTopic = "BROODIINNOX/" + DEVICE_ID + "/status";
  
  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["status"] = online ? "online" : "offline";
  doc["timestamp"] = rtc.now().unixtime();
  doc["device_locked"] = device_locked;
  doc["signal_quality"] = gsm_signal_quality;
  doc["mqtt_connected"] = mqtt_connected;
  doc["sensors_ok"] = (sensorsDetectedCount > 0);
  doc["relay_state"] = relay_state ? "ON" : "OFF";
  doc["day"] = day;
  doc["total_days"] = total_days;
  doc["failsafe_mode"] = failsafe_mode;
  
  char buf[256];
  size_t n = serializeJson(doc, buf);
  
  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(2000))) {
    bool ok = mqttClient.publish(statusTopic.c_str(), (const uint8_t*)buf, n, true);
    xSemaphoreGive(mqttMutex);
    if (!ok) {
      SerialMon.println("Failed to publish online status");
    } else {
      SerialMon.printf("Online status published: %s\n", online ? "ONLINE" : "OFFLINE");
    }
  }
}

// ========================================================
//                  GSM SETUP
// ========================================================
bool setup_gsm() {
  SerialMon.println("\n=== SIM7600 initialising ===");
  updateLoadingScreen(25);

  // Step 1: Power on modem using the proper sequence from working AT example.
  // Cut the modem's power rail FIRST so every boot starts from a known-OFF
  // modem. modemPowerOn() pulses PWKEY, and that pulse TOGGLES the modem's
  // power state when the modem is already on. An ESP32-only reset (USB
  // serial reset, task-WDT panic, reset button) does not always kill the
  // modem's supply, so booting with the modem still powered would switch it
  // OFF instead of on — presenting as permanent "MODEM FAILED" with no data
  // publishing until the modem's own supply is power-cycled by hand. Powering
  // off first makes the sequence deterministic on every boot.
  modemPowerOff();
  delay(500);
  modemPowerOn();

  // Step 2: Start SerialAT
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(3000);

  // Step 3: Initialize modem
  updateLoadingScreen(35);
  SerialMon.println("Initializing modem...");
  
  if (!modem.init()) {
    SerialMon.println("MODEM FAILED");
    updateLoadingScreen(40);
    delay(2000);
    return false;
  }

  SerialMon.println(modem.getModemInfo());
  updateLoadingScreen(45);

  // Step 4: Enable network clock update (KEY STEP from working AT example)
  SerialMon.println("Enabling network time...");
  modem.sendAT("+CTZU=1");
  modem.waitResponse();
  updateLoadingScreen(50);

  // Step 5: Wait for network
  SerialMon.println("Waiting for network...");
  if (!modem.waitForNetwork(60000L)) {
    SerialMon.println("No Network");
    updateLoadingScreen(55);
    delay(2000);
    return false;
  }

  SerialMon.println("Network OK");
  updateLoadingScreen(60);

  // Step 6: Get signal quality
  gsm_signal_quality = modem.getSignalQuality();
  SerialMon.printf("Signal CSQ : %d\n", gsm_signal_quality);

  // Step 7: Connect to GPRS
  SerialMon.print("GPRS APN [" + String(apn) + "]...");
  updateLoadingScreen(65);
  
  if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
    SerialMon.println(" FAILED");
    updateLoadingScreen(70);
    delay(2000);
    return false;
  }
  SerialMon.println(" OK   IP: " + modem.localIP().toString());

  // Step 8: NTP sync (optional)
  modem.NTPServerSync("pool.ntp.org", 20);

  // Step 9: Setup MQTT
  mqttClient.setBufferSize(600);
  mqttClient.setServer(mqtt_broker_buf, mqtt_port);
  mqttClient.setCallback(mqtt_callback);
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(10);

  SerialMon.println("GSM ready");
  return true;
}

// ========================================================
//                  SILENT GSM-ONLY RESTART (NO ESP.restart())
// ========================================================
// This is the fix for "GSM shows x and never reconnects on its own".
// It power-cycles ONLY the SIM7600 modem (same physical sequence used
// at boot: modemPowerOff() -> modemPowerOn()), re-initialises the AT
// link, re-registers on the network, reconnects GPRS, and reconnects
// MQTT — all from inside MQTTTask.
//
// Because SensorControlTask (relay/heater/failsafe) and DisplayTask
// (LCD/buttons) run as completely separate FreeRTOS tasks that never
// touch the modem, they keep running exactly as normal the whole time
// this executes: no LCD reset, no relay glitch, no lost settings, and
// critically no ESP32 reboot. The only visible symptom to a bystander
// is the small network icon staying on "x" a little longer than usual
// before it flips back to bars — same as a phone silently re-attaching
// to the tower after a dropped connection.
bool restartGSMSoft() {
  SerialMon.println("\n=== SILENT GSM RESTART (modem only, ESP32 keeps running) ===");

  // Mark link down immediately. Sensor/relay control and the LCD do not
  // depend on these flags for their core safety logic, so this is safe.
  gsm_initialized = false;
  mqtt_connected  = false;

  // Cleanly tear down MQTT first so we don't leave the library in a
  // half-connected state pointing at a modem we're about to power off.
  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(2000))) {
    if (mqttClient.connected()) mqttClient.disconnect();
    xSemaphoreGive(mqttMutex);
  }
  modem.gprsDisconnect();

  // Power-cycle just the SIM7600 (identical sequence to the one used at
  // boot) — this does NOT touch the ESP32's own power/reset lines.
  modemPowerOff();
  delay(500);
  modemPowerOn();

  // Restart the AT UART link to match the freshly-booted modem.
  SerialAT.end();
  delay(200);
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(3000);

  if (!modem.init()) {
    SerialMon.println("Silent GSM restart: modem.init() FAILED, will retry later");
    return false;
  }

  SerialMon.println(modem.getModemInfo());

  modem.sendAT("+CTZU=1");
  modem.waitResponse();

  SerialMon.println("Silent GSM restart: waiting for network...");
  if (!modem.waitForNetwork(60000L)) {
    SerialMon.println("Silent GSM restart: no network yet, will retry later");
    return false;
  }

  gsm_signal_quality = modem.getSignalQuality();
  SerialMon.printf("Silent GSM restart: signal CSQ %d\n", gsm_signal_quality);

  if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
    SerialMon.println("Silent GSM restart: GPRS connect FAILED, will retry later");
    return false;
  }
  SerialMon.println("Silent GSM restart: GPRS OK  IP: " + modem.localIP().toString());

  mqttClient.setBufferSize(600);
  mqttClient.setServer(mqtt_broker_buf, mqtt_port);
  mqttClient.setCallback(mqtt_callback);
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(10);

  gsm_initialized = true;
  SerialMon.println("Silent GSM restart: modem back online, reconnecting MQTT...");

  bool ok = mqttConnect();
  if (ok) {
    mqttReconnectFailCount = 0;
    SerialMon.println("Silent GSM restart: fully recovered.");
  } else {
    SerialMon.println("Silent GSM restart: modem is back but MQTT connect failed, will retry.");
  }
  return ok;
}

// ========================================================
//                  MQTT CONNECT
// ========================================================
bool mqttConnect() {
  if (!gsm_initialized) return false;

  if (!modem.isGprsConnected()) {
    SerialMon.println("GPRS lost — reconnecting...");
    updateLoadingScreen(70);
    if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
      SerialMon.println("GPRS reconnect FAILED");
      return false;
    }
    SerialMon.println("GPRS reconnected");
    delay(3000);
  }

  String clientId = "BROODIINNOX_" + DEVICE_ID + "_" + String(random(0xffff), HEX);
  SerialMon.println("MQTT connect as " + clientId + " to " + String(mqtt_broker_buf));

  updateLoadingScreen(75);
  bool ok;
  
  String willTopic = "BROODIINNOX/" + DEVICE_ID + "/status";
  String willMessage = "offline";
  
  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(5000))) {
    if (strlen(mqtt_username) > 0) {
      ok = mqttClient.connect(
        clientId.c_str(), 
        mqtt_username, 
        mqtt_password,
        willTopic.c_str(),
        0,
        true,
        willMessage.c_str(),
        true
      );
    } else {
      ok = mqttClient.connect(
        clientId.c_str(),
        NULL, NULL,
        willTopic.c_str(),
        0,
        true,
        willMessage.c_str(),
        true
      );
    }
    xSemaphoreGive(mqttMutex);
  } else {
    return false;
  }

  if (!ok) {
    SerialMon.printf("MQTT connect FAILED  state=%d\n", mqttClient.state());
    updateLoadingScreen(75);
    return false;
  }

  SerialMon.println("MQTT connected");
  updateLoadingScreen(80);

  bool subOk = true;
  if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(3000))) {
    subOk &= mqttClient.subscribe(topic_relay.c_str());
    subOk &= mqttClient.subscribe(topic_max_temp.c_str());
    subOk &= mqttClient.subscribe(topic_min_temp.c_str());
    subOk &= mqttClient.subscribe(topic_total_days.c_str());
    subOk &= mqttClient.subscribe(topic_sensor_control.c_str());
    subOk &= mqttClient.subscribe(topic_factory_reset.c_str());
    subOk &= mqttClient.subscribe(topic_animal_preset.c_str());
    subOk &= mqttClient.subscribe(topic_device_active.c_str());
    subOk &= mqttClient.subscribe(topic_set_time.c_str());
    subOk &= mqttClient.subscribe(topic_restart.c_str());
    xSemaphoreGive(mqttMutex);
  }

  if (!subOk) {
    SerialMon.println("WARNING: one or more subscribes failed");
  }

  mqtt_connected = true;
  pendingPublishStatus = true;
  
  safe_publish_online_status(true);

  SerialMon.println("MQTT ready");
  return true;
}

// ========================================================
//                  MQTT CALLBACK
// ========================================================
void mqtt_callback(char* topic, byte* payload, unsigned int length) {
  char msg[256];
  unsigned int copyLen = min(length, (unsigned int)(sizeof(msg) - 1));
  memcpy(msg, payload, copyLen);
  msg[copyLen] = '\0';
  String message(msg);
  String topicStr(topic);

  SerialMon.println("MQTT rx [" + topicStr + "] " + message);

  if (topicStr == topic_relay) {
    if (device_locked) return;
    if (message == "ON") {
      manual_relay_control = true;
      digitalWrite(RELAY, HIGH);
      relay_state = true;
    } else if (message == "OFF") {
      manual_relay_control = true;
      digitalWrite(RELAY, LOW);
      relay_state = false;
    } else if (message == "AUTO") {
      manual_relay_control = false;
    }
    pendingPublishStatus = true;
    safe_publish_online_status(true);
    return;
  }

  if (topicStr == topic_max_temp) {
    if (device_locked) return;
    int v = message.toInt();
    if (v > min_temp && v <= 50) {
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
        max_temp = v;
        xSemaphoreGive(dataMutex);
      }
      save_data(true);
      pendingPublishStatus = true;
    }
    return;
  }

  if (topicStr == topic_min_temp) {
    if (device_locked) return;
    int v = message.toInt();
    if (v >= 10 && v < max_temp) {
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
        min_temp = v;
        xSemaphoreGive(dataMutex);
      }
      save_data(true);
      pendingPublishStatus = true;
    }
    return;
  }

  if (topicStr == topic_total_days) {
    if (device_locked) return;
    int v = message.toInt();
    if (v >= 1 && v <= 365) {
      total_days = v;
      save_data(true);
      pendingPublishStatus = true;
    }
    return;
  }

  if (topicStr == topic_sensor_control) {
    if (device_locked) return;
    if      (message == "DS1:ON")  s1 = true;
    else if (message == "DS1:OFF") s1 = false;
    else if (message == "DS2:ON")  s2 = true;
    else if (message == "DS2:OFF") s2 = false;
    else if (message == "DS3:ON")  s3 = true;
    else if (message == "DS3:OFF") s3 = false;
    else if (message == "DS4:ON")  s4 = true;
    else if (message == "DS4:OFF") s4 = false;
    save_data(true);
    pendingPublishStatus = true;
    return;
  }

  if (topicStr == topic_factory_reset) {
    if (device_locked) return;
    if (message == "RESET") perform_factory_reset();
    return;
  }

  // Remote restart (bench/support): cleanly power down the modem first so
  // the next boot starts from a known state, then reboot the ESP32.
  if (topicStr == topic_restart) {
    if (device_locked) return;
    if (message == "RESTART") {
      SerialMon.println("REMOTE RESTART COMMAND RECEIVED — rebooting ESP32...");
      modemPowerOff();
      delay(300);
      ESP.restart();
    }
    return;
  }

  if (topicStr == topic_animal_preset) {
    if (device_locked) return;
    for (int i = 0; i < ANIMAL_COUNT; i++) {
      if (message == animal_names[i]) {
        apply_animal_settings(i);
        pendingPublishStatus = true;
        break;
      }
    }
    return;
  }

  if (topicStr == topic_set_time) {
    if (device_locked) return;

    bool     parsed = false;
    DateTime newTime;

    // Accept either a plain unix timestamp ("1735689600") or a text
    // date/time in the form "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS".
    bool isDigitsOnly = message.length() > 0;
    for (unsigned int i = 0; i < message.length(); i++) {
      if (!isDigit(message[i])) { isDigitsOnly = false; break; }
    }

    if (isDigitsOnly) {
      uint32_t epoch = (uint32_t)message.toInt();
      if (epoch > 0) {
        newTime = DateTime(epoch);
        parsed  = true;
      }
    } else if (message.length() >= 19) {
      int y, mo, d, h, mi, se;
      if (sscanf(message.c_str(), "%4d-%2d-%2d%*c%2d:%2d:%2d",
                 &y, &mo, &d, &h, &mi, &se) == 6 &&
          y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        newTime = DateTime(y, mo, d, h, mi, se);
        parsed  = true;
      }
    }

    if (parsed) {
      rtc.adjust(newTime);
      SerialMon.println("RTC updated remotely via MQTT set_time");
      pendingPublishStatus = true;
      safe_publish_online_status(true);
    } else {
      SerialMon.println("MQTT set_time: could not parse \"" + message + "\"");
    }
    return;
  }

  if (topicStr == topic_device_active) {
    if (message == "LOCKED") {
      device_locked        = true;
      manual_relay_control = false;
      digitalWrite(RELAY, LOW);
      relay_state          = false;
      digitalWrite(ALARM,  LOW);
      alarmState           = false;
      save_data(true);
      SerialMon.println("DEVICE LOCKED");
      currentDisplayScreen = -1;
      safe_publish_online_status(true);
    } else if (message == "ACTIVE") {
      device_locked        = false;
      save_data(true);
      SerialMon.println("DEVICE UNLOCKED");
      currentDisplayScreen = -1;
      safe_publish_online_status(true);
    }
    pendingPublishStatus = true;
    return;
  }
}

// ========================================================
//                  DS18B20 FUNCTIONS
// ========================================================
void discoverDS18B20Sensors() {
  SerialMon.println("Scanning for DS18B20 sensors...");
  sensorsDS18B20.begin();
  int count = sensorsDS18B20.getDeviceCount();

  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(300))) {
    sensorsDetectedCount = count;
    for (int i = 0; i < 4; i++) sensorFound[i] = false;

    for (int i = 0; i < min(count, 4); i++) {
      if (sensorsDS18B20.getAddress(sensorAddresses[i], i)) {
        sensorFound[i] = true;
        sensorsDS18B20.setResolution(sensorAddresses[i], 12);
      }
    }

    if (count == 0) {
      failsafe_mode = true;
      sensorError   = true;
      errorMsg      = "NO SENSORS";
      digitalWrite(RELAY, HIGH);
      relay_state          = true;
      pendingSensorEvent   = SEVENT_NO_SENSORS;
      SerialMon.println("  No sensors — FAILSAFE ON");
    } else if (failsafe_mode) {
      failsafe_mode      = false;
      sensorError        = false;
      errorMsg           = "";
      pendingSensorEvent = SEVENT_RECOVERED;
      SerialMon.printf("  Recovered: %d sensor(s)\n", count);
    }
    xSemaphoreGive(dataMutex);
  }

  SerialMon.printf("DS18B20 count: %d\n", count);
}

void readDS18B20Temperatures() {
  sensorsDS18B20.requestTemperatures();
  vTaskDelay(pdMS_TO_TICKS(750));

  float t1 = NAN, t2 = NAN, t3 = NAN, t4 = NAN;

  auto readOne = [](int idx) -> float {
    float v = sensorsDS18B20.getTempC(sensorAddresses[idx]);
    return (v == DEVICE_DISCONNECTED_C || v == 85.0f) ? NAN : v;
  };

  if (sensorFound[0]) t1 = readOne(0);
  if (sensorFound[1]) t2 = readOne(1);
  if (sensorFound[2]) t3 = readOne(2);
  if (sensorFound[3]) t4 = readOne(3);

  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
    temp1 = t1; temp2 = t2; temp3 = t3; temp4 = t4;
    xSemaphoreGive(dataMutex);
  }
}

// ========================================================
//                  FACTORY RESET
// ========================================================
void check_factory_reset() {
  static unsigned long reset_start = 0;
  static bool checking = false;
  static int  last_sec = -1;

  bool selPressed  = (digitalRead(SELECT) == LOW);
  bool backPressed = (digitalRead(BACK)   == LOW);

  if (selPressed && backPressed) {
    if (!checking) {
      checking    = true;
      reset_start = millis();
      last_sec    = -1;
      showLCD("Factory Reset", "Hold 5 seconds", "SELECT + BACK", "Release to cancel");
    } else {
      unsigned long held = millis() - reset_start;
      int cur = held / 1000;
      if (cur != last_sec && cur < 5) {
        showLCD("Factory Reset",
                "Hold " + String(5 - cur) + "s more",
                "SELECT + BACK",
                "Release to cancel");
        last_sec = cur;
      }
      if (held >= FACTORY_RESET_HOLD_TIME) {
        checking = false;
        enter_factory_reset_mode();
      }
    }
  } else {
    if (checking) {
      checking = false;
      showLCD("Factory Reset", "Cancelled", "", "");
      vTaskDelay(pdMS_TO_TICKS(800));
    }
  }
}

void enter_factory_reset_mode() {
  factory_reset_mode    = true;
  factory_reset_confirm = false;
  selected_animal       = 1; // start on the first animal so a preview is always visible
  showLCD("FACTORY RESET", "Choose an animal:", "UP/DOWN to browse", "SELECT to continue");
  vTaskDelay(pdMS_TO_TICKS(900));
  currentDisplayScreen = -1;
}

void exit_factory_reset_mode() {
  factory_reset_mode    = false;
  factory_reset_confirm = false;
  selected_animal        = 0;
  currentDisplayScreen   = -1;
}

void apply_animal_settings(int idx) {
  if (idx < 0 || idx >= ANIMAL_COUNT) return;
  AnimalSettings& s = animal_defaults[idx];

  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(200))) {
    max_temp              = s.max_temp;
    min_temp              = s.min_temp;
    total_days            = s.total_days;
    weekly_reduce_enabled = s.weekly_reduce;
    weekly_reduce_deg     = s.weekly_reduce_deg;
    weekly_max_floor      = s.max_temp_floor;
    weekly_min_floor      = s.min_temp_floor;
    weekly_min_deadband   = s.min_deadband;
    xSemaphoreGive(dataMutex);
  }

  DateTime now     = rtc.now();
  starting_year    = now.year();
  starting_month   = now.month();
  starting_day_val = now.day();

  s1 = s2 = s3 = s4       = true;
  selected_sensor_display  = 1;
  relay_state              = false;
  manual_relay_control     = false;
  lastReductionDay         = 0;

  save_data(true);
  SerialMon.println("Applied preset: " + s.name);
}

void perform_factory_reset(int animalIndex) {
  if (animalIndex < 0 || animalIndex >= ANIMAL_COUNT) animalIndex = 0;
  SerialMon.println("Factory reset executing... preset: " + animal_names[animalIndex]);
  prefs.begin("settings", false);
  prefs.clear();
  prefs.end();
  apply_animal_settings(animalIndex);
  screen               = 0;
  currentDisplayScreen = -1;
  showLCD("Factory Reset", "Complete!", "Preset: " + animal_names[animalIndex], "Restarting...");
  delay(2000);
  modemPowerOff();
  ESP.restart();
}

void show_factory_reset_screen() {
  if (!factory_reset_mode) return;

  int idx = selected_animal - 1;
  if (idx < 0) idx = 0;
  if (idx >= ANIMAL_COUNT) idx = ANIMAL_COUNT - 1;
  AnimalSettings& a = animal_defaults[idx];

  if (factory_reset_confirm) {
    update_line(0, "CONFIRM RESET?");
    update_line(1, "-> " + a.name);
    update_line(2, "Max:" + String(a.max_temp) + " Min:" + String(a.min_temp) +
                   " Days:" + String(a.total_days));
    update_line(3, "SELECT=Yes  BACK=No");
  } else {
    update_line(0, "ANIMAL " + String(selected_animal) + "/" + String(ANIMAL_COUNT) +
                   "  BACK=exit");
    update_line(1, "-> " + a.name);
    update_line(2, "Max:" + String(a.max_temp) + " Min:" + String(a.min_temp) +
                   " Days:" + String(a.total_days));
    update_line(3, "UP/DN=Browse SEL=Next");
  }
}

// ========================================================
//                  SETUP
// ========================================================
void setup() {
  SerialMon.begin(115200);
  SerialMon.println("\nBROODIINNOX starting — " + DEVICE_ID);

  // ----------------------------------------------------------------
  // Raise the FreeRTOS task-watchdog budget from the 5 s core default
  // to 120 s. GSM modem work inside MQTTTask (boot init, restartGSMSoft)
  // legitimately holds core 0 in TinyGSM AT timeouts for longer than
  // 5 s when the SIM7600 is absent or wedged; with the stock 5 s budget
  // the starved IDLE0 task panics the unit into a reboot loop
  // ("task_wdt: Task watchdog got triggered ... Aborting").
  //
  // The first 60 s budget was still too tight: with a modem that will
  // not answer, one restartGSMSoft() recovery pass (CIPSHUT timeout +
  // power-cycle + init retries) can hold core 0 for ~90 s, so the unit
  // panic-rebooted every ~100 s and never let the modem recovery
  // complete. 120 s covers a full recovery pass (power cycle ~15 s +
  // init ~20 s + waitForNetwork up to 60 s) while still catching
  // genuine hard hangs.
  #if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 1, 0)
    esp_task_wdt_config_t wdt_cfg = {};
    wdt_cfg.timeout_ms      = 120000;
    wdt_cfg.trigger_panic   = true;
    wdt_cfg.idle_core_mask  = (1 << 0) | (1 << 1);
    // The Arduino core already started the TWDT before setup() with the
    // 5 s default, so esp_task_wdt_init() would just log "TWDT already
    // initialized" and leave the 5 s budget in place. reconfigure() is
    // the call that actually changes a running watchdog.
    esp_err_t wdt_err = esp_task_wdt_reconfigure(&wdt_cfg);
    SerialMon.printf("task WDT budget -> %lus (rc=%d)\n", wdt_cfg.timeout_ms / 1000UL, (int)wdt_err);
  #else
    esp_task_wdt_init(120, true);
  #endif

  lcdMutex  = xSemaphoreCreateMutex();
  dataMutex = xSemaphoreCreateMutex();
  mqttMutex = xSemaphoreCreateMutex();
  if (!lcdMutex || !dataMutex || !mqttMutex) {
    SerialMon.println("FATAL: mutex creation failed — halting");
    while (1) delay(1000);
  }

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.createChar(ICON_NET_OK,  iconNetOk);
  lcd.createChar(ICON_NET_BAD, iconNetBad);

  updateLoadingScreen(0);

  pinMode(UP,     INPUT_PULLUP);
  pinMode(DOWN,   INPUT_PULLUP);
  pinMode(BACK,   INPUT_PULLUP);
  pinMode(SELECT, INPUT_PULLUP);
  pinMode(ALARM,  OUTPUT);
  pinMode(RELAY,  OUTPUT);
  digitalWrite(ALARM, LOW);
  digitalWrite(RELAY, LOW);
  pinMode(BUILTIN_LED, OUTPUT);
  digitalWrite(BUILTIN_LED, LOW);

  // Step 1: Detect sensors
  updateLoadingScreen(5);
  discoverDS18B20Sensors();

  // Step 2: Initialize RTC
  updateLoadingScreen(10);
  if (!rtc.begin()) {
    showLCD("RTC not found!", "Check I2C wiring", DEVICE_ID, "");
    SerialMon.println("RTC not found!");
    while (1) delay(500);
  }

  // Step 3: Load settings
  updateLoadingScreen(15);
  load_data();

  if (device_locked) {
    digitalWrite(RELAY, LOW);
    relay_state = false;
    SerialMon.println("WARNING: Device booted LOCKED");
  }

  startDate = DateTime(starting_year, starting_month, starting_day_val);

  // Step 4: Initialize GSM
  updateLoadingScreen(20);
  gsm_initialized = setup_gsm();

  // Step 5: Connect to MQTT
  if (gsm_initialized) {
    updateLoadingScreen(65);
    mqttConnect();
  }

  // Step 6: Start all tasks
  updateLoadingScreen(80);
  xTaskCreatePinnedToCore(SensorControlTask, "SensorCtrl", 8192, NULL, 2,
                          &SensorControlTaskHandle, 1);
  xTaskCreatePinnedToCore(DisplayTask,       "Display",    8192, NULL, 1,
                          &DisplayTaskHandle,       1);
  xTaskCreatePinnedToCore(MQTTTask,          "MQTT",       8192, NULL, 1,
                          &MQTTTaskHandle,          0);

  // Step 7: RTC TIME SYNC - USING AT+CCLK? THROUGH TINYGSM (RELIABLE METHOD)
  if (gsm_initialized) {
    String ip = modem.localIP().toString();
    if (ip != "0.0.0.0" && ip != "") {
      SerialMon.println("\n==========================================");
      SerialMon.println("PERFORMING RTC TIME SYNC");
      SerialMon.println("==========================================");
      
      updateLoadingScreen(85);
      
      // IMPORTANT: Wait for network time to be available
      // Many SIM7600 modules need 10-20 seconds after network registration
      SerialMon.println("Waiting 15 seconds for network time...");
      delay(15000); // Wait 15 seconds for network clock to synchronize
      
      // Update RTC from GSM using AT+CCLK? through TinyGSM
      // This is the SAME command that works in the AT version
      if (updateRTCFromGSM()) {
        SerialMon.println("RTC sync SUCCESSFUL!");
        updateLoadingScreen(92);
      } else {
        SerialMon.println("RTC sync FAILED - using stored time");
        updateLoadingScreen(88);
      }
      delay(1000);
      
      updateLoadingScreen(95);
    } else {
      SerialMon.println("WARNING: No valid IP address - skipping RTC sync");
      updateLoadingScreen(90);
      delay(2000);
    }
  } else {
    SerialMon.println("GSM not initialized - skipping RTC sync");
    updateLoadingScreen(90);
    delay(2000);
  }

  // Step 8: Setup complete!
  updateLoadingScreen(100);
  delay(1000);
  
  setupComplete = true;
  
  String sLine = sensorsDetectedCount > 0
    ? String(sensorsDetectedCount) + " sensor(s) OK"
    : "NO SENSORS-FAILSAFE";

  if (device_locked) {
    showLCD("** DEVICE LOCKED **", "Subscription ended", "Contact provider",
            gsm_initialized ? "GSM OK" : "Offline");
  } else {
    showLCD("BROODIINNOX Ready",
            "Day: " + String(day) + "/" + String(total_days),
            sLine,
            gsm_initialized ? "GSM OK" : "Offline Mode");
  }

  SerialMon.println("\n=== SETUP COMPLETE ===");
  SerialMon.println("Sensors: " + String(sensorsDetectedCount));
  SerialMon.println("GSM: " + String(gsm_initialized ? "OK" : "OFFLINE"));
  SerialMon.println("MQTT: " + String(mqtt_connected ? "Connected" : "Disconnected"));
  SerialMon.println("RTC time: " + String(rtc.now().year()) + "-" + 
                    String(rtc.now().month()) + "-" + 
                    String(rtc.now().day()) + " " +
                    String(rtc.now().hour()) + ":" +
                    String(rtc.now().minute()) + ":" +
                    String(rtc.now().second()));
  SerialMon.println("=====================================\n");
}

// ========================================================
//                  TASKS
// ========================================================
void SensorControlTask(void* pvParameters) {
  unsigned long lastSave        = 0;
  unsigned long lastSensorRetry = 0;

  for (;;) {
    if (device_locked) {
      digitalWrite(RELAY, LOW);
      relay_state          = false;
      manual_relay_control = false;
      digitalWrite(ALARM,  LOW);
      alarmState           = false;
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    check_factory_reset();
    remaining_days();

    unsigned long nowMs = millis();

    if (sensorsDetectedCount == 0) {
      if (nowMs - lastSensorRetry >= SENSOR_RETRY_INTERVAL) {
        lastSensorRetry = nowMs;
        discoverDS18B20Sensors();
        if (sensorsDetectedCount > 0) currentDisplayScreen = -1;
      }
    }

    readDS18B20Temperatures();
    compute_temperature_average();
    check_sensor_errors();
    apply_weekly_reduction_if_needed();
    check_and_control_relay();
    handle_alarm();

    if (millis() - lastSave >= SAVE_INTERVAL_MS) {
      save_data();
      lastSave = millis();
    }

    vTaskDelay(pdMS_TO_TICKS(800));
  }
}

void DisplayTask(void* pvParameters) {
  for (;;) {
    handle_buttons_nonblocking();

    if (pendingSensorEvent != SEVENT_NONE) {
      SensorEvent ev     = pendingSensorEvent;
      pendingSensorEvent = SEVENT_NONE;
      currentDisplayScreen = -1;

      if (ev == SEVENT_NO_SENSORS) {
        showLCD("** SENSOR FAULT **", "No DS18B20 found",
                "HEATER FORCED ON",  "Retry in 30s...");
      } else if (ev == SEVENT_RECOVERED) {
        showLCD("Sensor Recovered",
                String(sensorsDetectedCount) + " sensor(s) found",
                "Resuming control", "Failsafe cleared");
        vTaskDelay(pdMS_TO_TICKS(1500));
        currentDisplayScreen = -1;
      }
    }

    if (setupComplete) {
      unsigned long now = millis();
      if (now - lastDisplayUpdate >= DISPLAY_INTERVAL) {
        lastDisplayUpdate = now;

        if (device_locked) {
          if (currentDisplayScreen != -99) {
            if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(100))) {
              lcd.clear();
              for (int i = 0; i < 4; i++) displayBuffer[i] = "";
              xSemaphoreGive(lcdMutex);
            }
            currentDisplayScreen = -99;
          }
          update_line(0, "** DEVICE LOCKED **");
          update_line(1, "Subscription ended");
          update_line(2, "Contact provider");
          update_line(3, "All control OFF");

        } else if (factory_reset_mode) {
          show_factory_reset_screen();

        } else {
          if (screen != currentDisplayScreen) {
            if (xSemaphoreTake(lcdMutex, pdMS_TO_TICKS(100))) {
              lcd.clear();
              for (int i = 0; i < 4; i++) displayBuffer[i] = "";
              xSemaphoreGive(lcdMutex);
            }
            currentDisplayScreen = screen;
          }

          switch (screen) {
            case 0: update_main_screen(); break;

            case 1:
              update_line(0, "--- MAX TEMP ---");
              update_line(1, "  " + String(max_temp) + " C");
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 2:
              update_line(0, "--- MIN TEMP ---");
              update_line(1, "  " + String(min_temp) + " C");
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 3:
              update_line(0, "--- TOTAL DAYS ---");
              update_line(1, "  " + String(total_days) + " days");
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 4:
              update_line(0, "--- START MONTH ---");
              update_line(1, "  Month: " + String(starting_month));
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 5:
              update_line(0, "--- START DAY ---");
              update_line(1, "  Day: " + String(starting_day_val));
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 6:
              update_line(0, "--- START YEAR ---");
              update_line(1, "  " + String(starting_year));
              update_line(2, "UP/DOWN to adjust");
              update_line(3, "SELECT = next");
              break;

            case 7: {
              float t1, t2, t3, t4;
              if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
                t1 = temp1; t2 = temp2; t3 = temp3; t4 = temp4;
                xSemaphoreGive(dataMutex);
              } else { t1 = t2 = t3 = t4 = NAN; }
              update_line(0, "DS1:" + (isnan(t1) ? String(" ERR") : String(t1,1)+"C"));
              update_line(1, "DS2:" + (isnan(t2) ? String(" ERR") : String(t2,1)+"C"));
              update_line(2, "DS3:" + (isnan(t3) ? String(" ERR") : String(t3,1)+"C"));
              update_line(3, "DS4:" + (isnan(t4) ? String(" ERR") : String(t4,1)+"C"));
              break;
            }

            case 8:
              update_line(0, (selected_sensor_display==1?">":"") + String("DS1:") + (s1?"ON ":"OFF"));
              update_line(1, (selected_sensor_display==2?">":"") + String("DS2:") + (s2?"ON ":"OFF"));
              update_line(2, (selected_sensor_display==3?">":"") + String("DS3:") + (s3?"ON ":"OFF"));
              update_line(3, (selected_sensor_display==4?">":"") + String("DS4:") + (s4?"ON ":"OFF"));
              break;

            case 9:
              if (hotspot_active) {
                update_line(0, "--- HOTSPOT: ON ---");
                update_line(1, "SSID:" + String(HOTSPOT_SSID));
                update_line(2, "IP:" + WiFi.softAPIP().toString());
                update_line(3, "DOWN=off  auto 5min");
              } else {
                update_line(0, "--- HOTSPOT: OFF ---");
                update_line(1, "For broker/time cfg");
                update_line(2, "UP = turn ON");
                update_line(3, "SELECT = next screen");
              }
              break;

            default: update_main_screen(); break;
          }
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

void MQTTTask(void* pvParameters) {
  unsigned long lastSignalCheck = 0;
  const unsigned long SIGNAL_CHECK_INTERVAL = 60000;

  vTaskDelay(pdMS_TO_TICKS(3000));

  for (;;) {
    if (!gsm_initialized) {
      // If a previous silent restart attempt failed outright (e.g. modem
      // never came back up during setup_gsm()), keep retrying a full
      // silent restart here too, instead of doing nothing forever.
      unsigned long now = millis();
      if (now - lastMqttReconnect >= MQTT_RECONNECT_INTERVAL) {
        lastMqttReconnect = now;
        SerialMon.println("MQTTTask: GSM not initialised, attempting silent restart...");
        restartGSMSoft();
      }
      vTaskDelay(pdMS_TO_TICKS(10000));
      continue;
    }

    unsigned long now = millis();

    if (now - lastSignalCheck >= SIGNAL_CHECK_INTERVAL) {
      gsm_signal_quality = modem.getSignalQuality();
      lastSignalCheck = now;
      SerialMon.printf("Signal quality: %d\n", gsm_signal_quality);
      digitalWrite(BUILTIN_LED, mqtt_connected ? HIGH : LOW);
    }

    bool clientConnected;
    if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(100))) {
      clientConnected = mqttClient.connected();
      xSemaphoreGive(mqttMutex);
    } else {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!clientConnected) {
      mqtt_connected = false;

      if (now - lastMqttReconnect >= MQTT_RECONNECT_INTERVAL) {
        lastMqttReconnect = now;

        bool reconnected;
        if (mqttReconnectFailCount >= GSM_RESTART_FAIL_THRESHOLD) {
          // Plain MQTT/GPRS reconnects have failed repeatedly — the modem
          // itself is likely stuck. Power-cycle just the SIM7600 silently.
          SerialMon.println("MQTT: too many failed reconnects — "
                             "silently restarting GSM modem (no ESP reboot)...");
          reconnected = restartGSMSoft();
        } else {
          SerialMon.println("MQTT: attempting reconnect...");
          reconnected = mqttConnect();
        }

        if (reconnected) {
          SerialMon.println("MQTT: reconnected");
          mqttReconnectFailCount = 0;
          safe_publish_online_status(true);
        } else {
          mqttReconnectFailCount++;
          SerialMon.printf("MQTT: reconnect failed (%d consecutive)\n",
                            mqttReconnectFailCount);
        }
      }

      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    // Link looks connected — still do a cheap periodic sanity check on the
    // underlying radio/GPRS bearer in case the TCP socket has gone stale
    // without PubSubClient noticing yet.
    if (now - lastGsmHealthCheck >= GSM_HEALTH_CHECK_INTERVAL) {
      lastGsmHealthCheck = now;
      bool netOk  = modem.isNetworkConnected();
      bool gprsOk = modem.isGprsConnected();
      if (!netOk || !gprsOk) {
        SerialMon.println("MQTT: periodic health check found a dead link "
                           "(net=" + String(netOk) + " gprs=" + String(gprsOk) +
                           ") — silently restarting GSM modem...");
        restartGSMSoft();
        vTaskDelay(pdMS_TO_TICKS(1000));
        continue;
      }
    }

    if (xSemaphoreTake(mqttMutex, pdMS_TO_TICKS(200))) {
      mqttClient.loop();
      xSemaphoreGive(mqttMutex);
    }

    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
      lastHeartbeat = now;
      safe_publish_online_status(true);
      SerialMon.println("Heartbeat published");
    }

    if (pendingPublishStatus) {
      pendingPublishStatus = false;
      safe_publish_status();
    }

    if (now - lastMqttPublish >= MQTT_PUBLISH_INTERVAL) {
      lastMqttPublish = now;
      safe_publish_sensor_data();
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ========================================================
//                  MAIN SCREEN
// ========================================================
void update_main_screen() {
  update_line(0, "DAY  : " + String(day) + "/" + String(total_days));
  update_network_icon(); // top-right corner icon, independent of the rest of line 0

  DateTime now = rtc.now();
  char timeBuf[21];
  snprintf(timeBuf, sizeof(timeBuf), "TIME : %02d:%02d:%02d",
           now.hour(), now.minute(), now.second());
  update_line(1, String(timeBuf));

  if (day > total_days) {
    update_line(2, "BROODING COMPLETE");
    update_line(3, "SYSTEM OFF");
    return;
  }

  float av;
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
    av = ave_temp;
    xSemaphoreGive(dataMutex);
  } else { av = NAN; }

  update_line(2, "TEMP : " + (isnan(av) ? String("N/A ") : String(av, 1) + "C"));

  char flag[5] = "    ";
  if      (device_locked)                   strncpy(flag, "LCK ", 5);
  else if (failsafe_mode)                   strncpy(flag, "FSF ", 5);
  else if (sensorError || mismatchError)    strncpy(flag, "ERR ", 5);

  char net[5] = "    ";
  if      (!gsm_initialized)  strncpy(net, "NOGM", 5);
  else if (mqtt_connected)     strncpy(net, " 4G ", 5);
  else                         strncpy(net, "NO4G", 5);

  char line3[21];
  snprintf(line3, sizeof(line3), "HEAT:%s %s %s%s",
           manual_relay_control ? "MAN" : "AUT",
           relay_state          ? "ON " : "OFF",
           flag, net);
  update_line(3, String(line3));
}

// ========================================================
//                  BUTTON HANDLING
// ========================================================
void handle_buttons_nonblocking() {
  bool upState     = digitalRead(UP);
  bool downState   = digitalRead(DOWN);
  bool selectState = digitalRead(SELECT);
  bool backState   = digitalRead(BACK);

  static unsigned long lastDebounce = 0;
  unsigned long now = millis();
  if (now - lastDebounce <= 60) {
    lastUpState = upState; lastDownState = downState;
    lastSelectState = selectState; lastBackState = backState;
    return;
  }
  lastDebounce = now;

  if (factory_reset_mode) {
    if (!factory_reset_confirm) {
      // Step 1: browse animal presets, with a live settings preview.
      if (upState == LOW && lastUpState == HIGH) {
        selected_animal = (selected_animal % ANIMAL_COUNT) + 1;
        currentDisplayScreen = -1;
      }
      if (downState == LOW && lastDownState == HIGH) {
        selected_animal = (selected_animal <= 1) ? ANIMAL_COUNT : selected_animal - 1;
        currentDisplayScreen = -1;
      }
      if (selectState == LOW && lastSelectState == HIGH) {
        factory_reset_confirm = true; // move to the confirmation step
        currentDisplayScreen  = -1;
      }
      if (backState == LOW && lastBackState == HIGH)
        exit_factory_reset_mode();

    } else {
      // Step 2: explicit confirmation before wiping settings and restarting.
      if (selectState == LOW && lastSelectState == HIGH) {
        perform_factory_reset(selected_animal - 1);
      }
      if (backState == LOW && lastBackState == HIGH) {
        factory_reset_confirm = false; // back out to browsing, not fully out
        currentDisplayScreen  = -1;
      }
    }

  } else if (device_locked) {
    // Buttons ignored when locked

  } else {
    if (selectState == LOW && lastSelectState == HIGH) {
      screen = (screen + 1) % 10;
      currentDisplayScreen = -1;
    }
    if (backState == LOW && lastBackState == HIGH) {
      screen = (screen == 0) ? 9 : screen - 1;
      currentDisplayScreen = -1;
    }

    bool changed = false;
    if (upState == LOW && lastUpState == HIGH) {
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
        switch (screen) {
          case 1: max_temp++; break;
          case 2: min_temp++; break;
          case 3: total_days = min(total_days + 1, 365); break;
          case 4: starting_month   = (starting_month % 12) + 1; break;
          case 5: starting_day_val = (starting_day_val % 31) + 1; break;
          case 6: starting_year++; break;
          case 8: selected_sensor_display = (selected_sensor_display % 4) + 1; break;
        }
        xSemaphoreGive(dataMutex);
        changed = true;
      }
      // Screen 9 (Hotspot) doesn't need dataMutex, handle separately.
      if (screen == 9 && !hotspot_active) {
        startHotspot();
      }
    }
    if (downState == LOW && lastDownState == HIGH) {
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
        switch (screen) {
          case 1: if (max_temp > min_temp + 1)    max_temp--; break;
          case 2: if (min_temp > 10)              min_temp--; break;
          case 3: total_days = (total_days == 1)  ? 365 : total_days - 1; break;
          case 4: starting_month   = (starting_month==1)   ? 12 : starting_month-1; break;
          case 5: starting_day_val = (starting_day_val==1) ? 31 : starting_day_val-1; break;
          case 6: if (starting_year > 2020) starting_year--; break;
          case 8:
            switch (selected_sensor_display) {
              case 1: s1=!s1; break; case 2: s2=!s2; break;
              case 3: s3=!s3; break; case 4: s4=!s4; break;
            }
            break;
        }
        xSemaphoreGive(dataMutex);
        changed = true;
      }
      // Screen 9 (Hotspot) doesn't need dataMutex, handle separately.
      if (screen == 9 && hotspot_active) {
        stopHotspot();
      }
    }
    if (changed) {
      save_data();
      pendingPublishStatus = true;
    }
  }

  lastUpState = upState; lastDownState = downState;
  lastSelectState = selectState; lastBackState = backState;
}

// ========================================================
//                  HELPER FUNCTIONS
// ========================================================
void compute_temperature_average() {
  float total = 0; int count = 0;
  float t1, t2, t3, t4;
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
    t1 = temp1; t2 = temp2; t3 = temp3; t4 = temp4;
    xSemaphoreGive(dataMutex);
  } else { return; }

  if (s1 && !isnan(t1)) { total += t1; count++; }
  if (s2 && !isnan(t2)) { total += t2; count++; }
  if (s3 && !isnan(t3)) { total += t3; count++; }
  if (s4 && !isnan(t4)) { total += t4; count++; }

  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
    ave_temp = (count > 0) ? (total / count) : NAN;
    xSemaphoreGive(dataMutex);
  }
}

bool all_active_sensors_failed() {
  if (!(s1 || s2 || s3 || s4)) return true;
  return !((s1 && !isnan(temp1)) || (s2 && !isnan(temp2)) ||
           (s3 && !isnan(temp3)) || (s4 && !isnan(temp4)));
}

void check_sensor_errors() {
  int enabled = 0, valid = 0;
  if (s1) { enabled++; if (!isnan(temp1)) valid++; }
  if (s2) { enabled++; if (!isnan(temp2)) valid++; }
  if (s3) { enabled++; if (!isnan(temp3)) valid++; }
  if (s4) { enabled++; if (!isnan(temp4)) valid++; }

  bool se = false, me = false, fm = false;
  String em = "";

  if (all_active_sensors_failed()) {
    fm = true; se = true; em = "ALL SENS FAIL";
  } else {
    if (enabled > 0 && valid < enabled) {
      se = true;
      int f = enabled - valid;
      em = String(f) + " SENSOR" + (f > 1 ? "S" : "") + " FAIL";
    }
    if (valid > 1) {
      float tot = 0;
      if (s1 && !isnan(temp1)) tot += temp1;
      if (s2 && !isnan(temp2)) tot += temp2;
      if (s3 && !isnan(temp3)) tot += temp3;
      if (s4 && !isnan(temp4)) tot += temp4;
      float avg = tot / valid;
      int mm = 0;
      if (s1 && !isnan(temp1) && fabs(temp1-avg) > 5.0f) mm++;
      if (s2 && !isnan(temp2) && fabs(temp2-avg) > 5.0f) mm++;
      if (s3 && !isnan(temp3) && fabs(temp3-avg) > 5.0f) mm++;
      if (s4 && !isnan(temp4) && fabs(temp4-avg) > 5.0f) mm++;
      if (mm > valid / 2) { me = true; em = "MISMATCH"; }
    }
  }

  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
    sensorError = se; mismatchError = me;
    failsafe_mode = fm; errorMsg = em;
    xSemaphoreGive(dataMutex);
  }
}

void check_and_control_relay() {
  if (device_locked) {
    digitalWrite(RELAY, LOW); relay_state = false; return;
  }
  if (day > total_days) {
    digitalWrite(RELAY, LOW); relay_state = false;
    digitalWrite(ALARM, LOW); return;
  }
  if (failsafe_mode) {
    digitalWrite(RELAY, HIGH); relay_state = true; return;
  }
  if (manual_relay_control) return;

  float av;
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
    av = ave_temp; xSemaphoreGive(dataMutex);
  } else { return; }

  if (isnan(av)) { digitalWrite(RELAY, LOW); relay_state = false; return; }
  if (av <= 25.0f)    { digitalWrite(RELAY, HIGH); relay_state = true;  return; }
  if (av >= max_temp) { digitalWrite(RELAY, LOW);  relay_state = false; return; }
  if (av < min_temp)  { digitalWrite(RELAY, HIGH); relay_state = true; }
  else if (av >= max_temp) { digitalWrite(RELAY, LOW); relay_state = false; }
}

void remaining_days() {
  startDate        = DateTime(starting_year, starting_month, starting_day_val);
  TimeSpan elapsed = rtc.now() - startDate;
  long computed    = elapsed.days() + 1;
  if (computed < 1) computed = 1;
  day = (int)computed;
}

void handle_alarm() {
  if (device_locked) {
    digitalWrite(ALARM, LOW); alarmState = false; return;
  }
  bool se, me;
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50))) {
    se = sensorError; me = mismatchError;
    xSemaphoreGive(dataMutex);
  } else { return; }

  if (se || me) {
    unsigned long now = millis();
    if (now - previousAlarmMillis >= alarmInterval) {
      previousAlarmMillis = now;
      alarmState = !alarmState;
      digitalWrite(ALARM, alarmState ? HIGH : LOW);
    }
  } else {
    digitalWrite(ALARM, LOW);
    alarmState = false;
  }
}

void apply_weekly_reduction_if_needed() {
  if (!weekly_reduce_enabled) return;
  if (day > 0 && (day % 7) == 0 && day != lastReductionDay) {
    apply_weekly_temp_reduction();
    lastReductionDay = day;
    save_data(true);
    pendingPublishStatus = true;
    SerialMon.printf("Weekly reduction day %d -> max:%d min:%d\n",
                     day, max_temp, min_temp);
  }
}

void apply_weekly_temp_reduction() {
  if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
    int pm = max_temp, pn = min_temp;
    max_temp -= weekly_reduce_deg;
    min_temp -= weekly_reduce_deg;
    if (max_temp < weekly_max_floor) max_temp = weekly_max_floor;
    if (min_temp < weekly_min_floor) min_temp = weekly_min_floor;
    if ((max_temp - min_temp) < weekly_min_deadband) {
      int nm = min_temp + weekly_min_deadband;
      if (nm <= pm) {
        max_temp = nm;
      } else {
        min_temp = max_temp - weekly_min_deadband;
        if (min_temp < weekly_min_floor) {
          min_temp = weekly_min_floor;
          max_temp = min_temp + weekly_min_deadband;
        }
      }
    }
    xSemaphoreGive(dataMutex);
  }
}

// ========================================================
//                  PREFERENCES (NVS)
// ========================================================
void save_data(bool force) {
  static unsigned long lastSave = 0;
  unsigned long now = millis();
  if (!force && now - lastSave < SAVE_INTERVAL_MS) return;
  lastSave = now;

  prefs.begin("settings", false);
  prefs.putInt ("total_days",            total_days);
  prefs.putInt ("max_temp",              max_temp);
  prefs.putInt ("min_temp",              min_temp);
  prefs.putInt ("starting_year",         starting_year);
  prefs.putInt ("starting_month",        starting_month);
  prefs.putInt ("starting_day",          starting_day_val);
  prefs.putBool("s1",                    s1);
  prefs.putBool("s2",                    s2);
  prefs.putBool("s3",                    s3);
  prefs.putBool("s4",                    s4);
  prefs.putInt ("lastReductionDay",      lastReductionDay);
  prefs.putBool("weekly_reduce_enabled", weekly_reduce_enabled);
  prefs.putInt ("weekly_reduce_deg",     weekly_reduce_deg);
  prefs.putInt ("weekly_max_floor",      weekly_max_floor);
  prefs.putInt ("weekly_min_floor",      weekly_min_floor);
  prefs.putInt ("weekly_min_deadband",   weekly_min_deadband);
  prefs.putBool("device_locked",         device_locked);
  prefs.putString("mqtt_broker",         String(mqtt_broker_buf));
  prefs.end();
}

void load_data() {
  prefs.begin("settings", true);
  total_days            = prefs.getInt ("total_days",            total_days);
  max_temp               = prefs.getInt ("max_temp",              max_temp);
  min_temp                = prefs.getInt ("min_temp",              min_temp);
  starting_year           = prefs.getInt ("starting_year",         starting_year);
  starting_month          = prefs.getInt ("starting_month",        starting_month);
  starting_day_val        = prefs.getInt ("starting_day",          starting_day_val);
  s1                      = prefs.getBool("s1",                    s1);
  s2                      = prefs.getBool("s2",                    s2);
  s3                      = prefs.getBool("s3",                    s3);
  s4                      = prefs.getBool("s4",                    s4);
  lastReductionDay        = prefs.getInt ("lastReductionDay",      lastReductionDay);
  weekly_reduce_enabled   = prefs.getBool("weekly_reduce_enabled", weekly_reduce_enabled);
  weekly_reduce_deg       = prefs.getInt ("weekly_reduce_deg",     weekly_reduce_deg);
  weekly_max_floor        = prefs.getInt ("weekly_max_floor",      weekly_max_floor);
  weekly_min_floor        = prefs.getInt ("weekly_min_floor",      weekly_min_floor);
  weekly_min_deadband     = prefs.getInt ("weekly_min_deadband",   weekly_min_deadband);
  device_locked           = prefs.getBool("device_locked",         false);
  String savedBroker      = prefs.getString("mqtt_broker",         String(mqtt_broker_buf));
  savedBroker.toCharArray(mqtt_broker_buf, sizeof(mqtt_broker_buf));
  prefs.end();
}

// ========================================================
//                  MAIN LOOP
// ========================================================
// The main Arduino loop() is otherwise unused (all real work runs in the
// FreeRTOS tasks started in setup()), so it's a safe, isolated place to
// service the hotspot config portal without touching any existing task.
void loop() {
  if (hotspot_active) {
    configServer.handleClient();

    if (hotspot_restart_pending && millis() >= hotspot_restart_at_ms) {
      SerialMon.println("Restarting after hotspot config save...");
      modemPowerOff();
      ESP.restart();
    }

    if (!hotspot_restart_pending &&
        (millis() - hotspotStartMillis >= HOTSPOT_TIMEOUT_MS)) {
      SerialMon.println("Hotspot idle timeout - turning off automatically");
      stopHotspot();
    }
  }

  delay(10);
}
