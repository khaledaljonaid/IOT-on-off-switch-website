#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <ArduinoJson.h>
#include "UTF8_Persian_Arabic_Reshaper.h"

// Libraries required for the Captive Portal
#include <DNSServer.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>

// -------------------------------------------------------------
// 1. HARDWARE & PINS DEFINITION
// -------------------------------------------------------------
#define BUTTON_DOWN_PIN 0
#define BUTTON_UP_PIN 15
const int mqttLedPin = 2;

#define HOLD_DURATION 1000

WiFiClient espClient;
PubSubClient client(espClient);
Preferences preferences;

// Captive Portal Setup
DNSServer dnsServer;
AsyncWebServer server(80);
bool isCaptivePortalActive = false;

// MQTT Topics for Smart Home Setup
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char* setup_topic = "esp32/setup/config";
const char* delete_topic = "esp32/setup/delete";

// -------------------------------------------------------------
// 2. RECEIVER MANAGEMENT
// -------------------------------------------------------------
const int MAX_RECEIVERS = 6;
const int VISIBLE_ITEMS = 4;

struct ReceiverDevice {
  String nameEn;
  String nameAr;
  String pubTopic;
  String subTopic;
  uint8_t mac[6];
  bool state;
  bool isConfigured;
};

ReceiverDevice receivers[MAX_RECEIVERS];
int selectedIndex = 0;
int topIndex = 0;

unsigned long downPressTime = 0;
bool isDownPressed = false;
bool downHoldHandled = false;

unsigned long upPressTime = 0;
bool isUpPressed = false;
bool upHoldHandled = false;

typedef struct struct_message {
  uint8_t receiver_id;
  uint8_t state;
  uint8_t channel;
} struct_message;

struct_message myData;
uint8_t currentChannel = 1;
esp_now_peer_info_t peerInfo;

unsigned long lastMqttRetry = 0;
const unsigned long mqttRetryInterval = 5000;
unsigned long lastHeartbeat = 0;
const unsigned long heartbeatInterval = 1000;

int currentLang = -1;

U8G2_SH1106_128X64_NONAME_F_HW_I2C display(U8G2_R0, /* reset=*/U8X8_PIN_NONE);
UTF8_Persian_Arabic_Reshaper reshaper;

// -------------------------------------------------------------
// 3. CAPTIVE PORTAL HTML (Matched to Dark Theme UI)
// -------------------------------------------------------------
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wi-Fi Setup</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      background-color: #0b0f19; 
      color: #ffffff; 
      margin: 0; 
      display: flex; 
      flex-direction: column; 
      height: 100vh; 
    }
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 20px 30px; 
      width: 100%; 
      box-sizing: border-box; 
      position: absolute; 
      top: 0; 
    }
    .logo { 
      color: #00d2ff; 
      font-size: 24px; 
      font-weight: 700; 
      letter-spacing: 1px; 
    }
    .lang-btn { 
      display: inline-flex; 
      align-items: center; 
      gap: 6px; 
      color: #00d2ff; 
      font-size: 14px; 
      background: none; 
      border: none; 
      cursor: pointer; 
      font-family: inherit; 
    }
    .lang-btn svg { width: 16px; height: 16px; }
    .form-container { 
      margin: auto; 
      width: 85%; 
      max-width: 320px; 
      text-align: center; 
    }
    h1 { 
      font-size: 22px; 
      margin-bottom: 30px; 
      font-weight: 600; 
    }
    input { 
      width: 100%; 
      padding: 12px 15px; 
      margin-bottom: 16px; 
      background-color: rgba(255, 255, 255, 0.03); 
      border: 1px solid rgba(255, 255, 255, 0.1); 
      border-radius: 6px; 
      box-sizing: border-box; 
      font-size: 14px; 
      color: #ffffff; 
      outline: none; 
      transition: 0.3s; 
    }
    input::placeholder { color: #888; }
    input:focus { border-color: #00d2ff; background-color: rgba(0, 210, 255, 0.05); }
    button.authBtn { 
      width: 100%; 
      padding: 12px; 
      background-color: #00d2ff; 
      color: #ffffff; 
      border: none; 
      border-radius: 6px; 
      cursor: pointer; 
      font-size: 15px; 
      font-weight: 600; 
      transition: 0.2s; 
      margin-top: 5px; 
    }
    button.authBtn:hover { background-color: #00a8cc; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">KAD</div>
    <button class="lang-btn" onclick="toggleLang()" dir="rtl">
      <span id="langText">عربي</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
    </button>
  </div>

  <div class="form-container">
    <h1 id="title">Wi-Fi Setup</h1>
    <form action="/save" method="POST">
      <input type="text" name="ssid" id="ssid" placeholder="Wi-Fi Name (SSID)" required>
      <input type="password" name="pass" id="pass" placeholder="Password" required>
      <button type="submit" class="authBtn" id="btn">Connect</button>
    </form>
  </div>

  <script>
    let ar = false;
    function toggleLang() {
      ar = !ar;
      document.documentElement.lang = ar ? "ar" : "en";
      document.documentElement.dir = ar ? "rtl" : "ltr";
      document.getElementById("langText").innerText = ar ? "English" : "عربي";
      document.querySelector(".lang-btn").dir = ar ? "ltr" : "rtl";
      document.getElementById("title").innerText = ar ? "إعداد شبكة Wi-Fi" : "Wi-Fi Setup";
      document.getElementById("ssid").placeholder = ar ? "اسم الشبكة (SSID)" : "Wi-Fi Name (SSID)";
      document.getElementById("pass").placeholder = ar ? "كلمة المرور" : "Password";
      document.getElementById("btn").innerText = ar ? "اتصال" : "Connect";
    }
  </script>
</body>
</html>
)rawliteral";

// Captive Portal Redirect Handler
class CaptiveRequestHandler : public AsyncWebHandler {
public:
  CaptiveRequestHandler() {}
  virtual ~CaptiveRequestHandler() {}
  bool canHandle(AsyncWebServerRequest *request) { return true; }
  void handleRequest(AsyncWebServerRequest *request) {
    request->redirect("http://192.168.4.1/");
  }
};

// -------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------
void parseMacAddress(const char* macStr, uint8_t* macBytes) {
  sscanf(macStr, "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx",
         &macBytes[0], &macBytes[1], &macBytes[2],
         &macBytes[3], &macBytes[4], &macBytes[5]);
}

String getDisplayText(String enText, String arText) {
  if (currentLang == 0) return enText;
  return reshaper.reshape((char*)arText.c_str());
}

// -------------------------------------------------------------
// DISPLAY SCREENS
// -------------------------------------------------------------
void runLanguageSetup() {
  int tempLang = 0; 
  bool selected = false;

  while (!selected) {
    display.clearBuffer();
    display.setCursor(10, 15); display.print("Select Language:");
    display.setCursor(10, 32); display.print(reshaper.reshape((char*)"اختر اللغة:").c_str());
    display.setCursor(10, 48); display.print(tempLang == 0 ? "> English" : "  English");
    display.setCursor(10, 62); display.print(tempLang == 1 ? (String(">") + reshaper.reshape((char*)"عربي ")).c_str() : reshaper.reshape((char*)"عربي  ").c_str());
    display.sendBuffer();

    if (digitalRead(BUTTON_DOWN_PIN) == LOW) { tempLang = (tempLang == 0) ? 1 : 0; delay(300); }
    if (digitalRead(BUTTON_UP_PIN) == LOW) {
      currentLang = tempLang;
      preferences.putInt("lang", currentLang);
      selected = true;
      display.clearBuffer(); display.setCursor(30, 35); display.print(getDisplayText("Saved: EN", "تم الحفظ").c_str()); display.sendBuffer(); delay(1000);
    }
  }
}

void renderMainMenu() {
  if(isCaptivePortalActive) return; // Block main menu rendering during setup
  
  display.clearBuffer();
  int pairedCount = 0;
  for (int i = 0; i < MAX_RECEIVERS; i++) { if (receivers[i].isConfigured) pairedCount++; }

  if (pairedCount == 0) {
    display.setCursor(10, 30); display.print(getDisplayText("No Devices Paired", "لا توجد أجهزة").c_str());
    display.setCursor(15, 50); display.print(getDisplayText("Scan QR to add", "امسح الرمز للإضافة").c_str());
    display.sendBuffer(); return;
  }

  if (!receivers[selectedIndex].isConfigured) {
    for (int i = 0; i < MAX_RECEIVERS; i++) {
      if (receivers[i].isConfigured) { selectedIndex = i; break; }
    }
  }

  int renderRow = 0;
  int currentVisibleCount = 0;

  for (int i = 0; i < MAX_RECEIVERS; i++) {
    if (!receivers[i].isConfigured) continue;
    if (currentVisibleCount >= topIndex && renderRow < VISIBLE_ITEMS) {
      int yPos = (renderRow * 16) + 14;
      display.setCursor(0, yPos); display.print(i == selectedIndex ? "> " : "  ");
      String devName = (currentLang == 1) ? receivers[i].nameAr : receivers[i].nameEn;
      if (currentLang == 1) devName = reshaper.reshape((char*)devName.c_str());
      display.print(devName.c_str());
      renderRow++;
    }
    currentVisibleCount++;
  }
  display.sendBuffer();
}

void showDeviceActionScreen(int idx) {
  display.clearBuffer();
  display.setCursor(0, 20);
  String devName = (currentLang == 1) ? receivers[idx].nameAr : receivers[idx].nameEn;
  if (currentLang == 1) devName = reshaper.reshape((char*)devName.c_str());
  display.print(devName.c_str());

  display.setCursor(0, 45);
  if (currentLang == 0) {
    display.print(" State: "); display.print(receivers[idx].state ? "ON" : "OFF");
  } else {
    display.print(reshaper.reshape((char*)" الحالة: ").c_str());
    display.print(receivers[idx].state ? reshaper.reshape((char*)"تشغيل").c_str() : reshaper.reshape((char*)"إيقاف").c_str());
  }
  display.sendBuffer(); delay(1200); renderMainMenu();
}

// -------------------------------------------------------------
// DATA STORAGE & ESP-NOW
// -------------------------------------------------------------
void registerPeer(uint8_t* macAddr) {
  esp_now_del_peer(macAddr);
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, macAddr, 6);
  peerInfo.channel = currentChannel;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
}

void sendEspNowToReceiver(int idx) {
  if (!receivers[idx].isConfigured) return;
  if (WiFi.status() == WL_CONNECTED) currentChannel = WiFi.channel();
  
  registerPeer(receivers[idx].mac);
  myData.receiver_id = idx; myData.state = receivers[idx].state ? 1 : 0; myData.channel = currentChannel;
  for (int i = 0; i < 3; i++) { esp_now_send(receivers[idx].mac, (uint8_t*)&myData, sizeof(myData)); delay(5); }
  
  String key = "st_" + String(idx); preferences.putBool(key.c_str(), receivers[idx].state);
}

void loadStoredReceivers() {
  preferences.begin("dev_store", false);
  for (int i = 0; i < MAX_RECEIVERS; i++) {
    String nameEnKey = "nE_" + String(i); String nameArKey = "nA_" + String(i);
    String pubKey = "pub_" + String(i); String subKey = "sub_" + String(i);
    String macKey = "mac_" + String(i); String stateKey = "st_" + String(i);

    if (preferences.isKey(nameEnKey.c_str())) {
      receivers[i].nameEn = preferences.getString(nameEnKey.c_str(), ""); receivers[i].nameAr = preferences.getString(nameArKey.c_str(), "");
      receivers[i].pubTopic = preferences.getString(pubKey.c_str(), ""); receivers[i].subTopic = preferences.getString(subKey.c_str(), "");
      String macStr = preferences.getString(macKey.c_str(), ""); parseMacAddress(macStr.c_str(), receivers[i].mac);
      receivers[i].state = preferences.getBool(stateKey.c_str(), false); receivers[i].isConfigured = true;
    } else {
      receivers[i].isConfigured = false; receivers[i].state = false;
    }
  }
}

void saveReceiverToNVS(int idx, String nameEn, String nameAr, String pub, String sub, String macStr) {
  receivers[idx].nameEn = nameEn; receivers[idx].nameAr = nameAr; receivers[idx].pubTopic = pub; receivers[idx].subTopic = sub;
  parseMacAddress(macStr.c_str(), receivers[idx].mac); receivers[idx].isConfigured = true;

  preferences.putString(("nE_" + String(idx)).c_str(), nameEn); preferences.putString(("nA_" + String(idx)).c_str(), nameAr);
  preferences.putString(("pub_" + String(idx)).c_str(), pub); preferences.putString(("sub_" + String(idx)).c_str(), sub);
  preferences.putString(("mac_" + String(idx)).c_str(), macStr);
}

void deleteReceiverFromNVS(int idx) {
  if (idx < 0 || idx >= MAX_RECEIVERS) return;
  receivers[idx].isConfigured = false; receivers[idx].state = false;
  preferences.remove(("nE_" + String(idx)).c_str()); preferences.remove(("nA_" + String(idx)).c_str());
  preferences.remove(("pub_" + String(idx)).c_str()); preferences.remove(("sub_" + String(idx)).c_str());
  preferences.remove(("mac_" + String(idx)).c_str()); preferences.remove(("st_" + String(idx)).c_str());
}

// -------------------------------------------------------------
// MQTT & CALLBACKS
// -------------------------------------------------------------
void callback(char* topic, byte* payload, unsigned int length) {
  String message = ""; for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  String recvTopic = String(topic);

  if (recvTopic == setup_topic) {
    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, message)) {
      String nameEn = doc["nameEn"] | "New Device"; String nameAr = doc["nameAr"] | "جهاز جديد";
      String pub = doc["pubTopic"] | ""; String sub = doc["subTopic"] | "";
      String macStr = doc["mac"] | "FF:FF:FF:FF:FF:FF";
      int targetIdx = doc.containsKey("targetIdx") ? doc["targetIdx"].as<int>() : -1;
      
      if (targetIdx < 0 || targetIdx >= MAX_RECEIVERS) {
        for (int i = 0; i < MAX_RECEIVERS; i++) {
          if (!receivers[i].isConfigured) { targetIdx = i; break; }
        }
        if (targetIdx == -1) targetIdx = 0;
      }
      saveReceiverToNVS(targetIdx, nameEn, nameAr, pub, sub, macStr);
      if (client.connected() && pub.length() > 0) client.subscribe(pub.c_str());
      renderMainMenu();
    }
    return;
  }

  if (recvTopic == delete_topic) {
    StaticJsonDocument<128> doc;
    if (!deserializeJson(doc, message)) {
      int targetIdx = doc["index"] | -1; String source = doc["source"] | "web";
      if (targetIdx >= 0 && targetIdx < MAX_RECEIVERS && source != "esp32") { deleteReceiverFromNVS(targetIdx); renderMainMenu(); }
    }
    return;
  }

  for (int i = 0; i < MAX_RECEIVERS; i++) {
    if (receivers[i].isConfigured && receivers[i].pubTopic == recvTopic) {
      bool newState = (message == "1");
      if (receivers[i].state != newState) {
        receivers[i].state = newState; sendEspNowToReceiver(i); showDeviceActionScreen(i);
      }
      if (client.connected() && receivers[i].subTopic.length() > 0) client.publish(receivers[i].subTopic.c_str(), receivers[i].state ? "1" : "0");
      break;
    }
  }
}

void manageConnections() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) return; // Prevent loop blocking

  if (!client.connected()) {
    digitalWrite(mqttLedPin, LOW);
    if (now - lastMqttRetry > mqttRetryInterval) {
      lastMqttRetry = now;
      String clientId = "ESP32Sender-" + String(random(0xffff), HEX);
      if (client.connect(clientId.c_str())) {
        digitalWrite(mqttLedPin, HIGH);
        client.subscribe(setup_topic); client.subscribe(delete_topic);
        for (int i = 0; i < MAX_RECEIVERS; i++) {
          if (receivers[i].isConfigured) {
            if (receivers[i].pubTopic.length() > 0) client.subscribe(receivers[i].pubTopic.c_str());
            if (receivers[i].subTopic.length() > 0) client.publish(receivers[i].subTopic.c_str(), receivers[i].state ? "1" : "0");
          }
        }
      }
    }
  } else { client.loop(); }
}

void OnDataSent(const wifi_tx_info_t* tx_info, esp_now_send_status_t status) {}

// -------------------------------------------------------------
// SETUP W/ CAPTIVE PORTAL LOGIC
// -------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  pinMode(mqttLedPin, OUTPUT); digitalWrite(mqttLedPin, LOW);
  pinMode(BUTTON_DOWN_PIN, INPUT_PULLUP); pinMode(BUTTON_UP_PIN, INPUT_PULLUP);

  Wire.begin();
  display.begin(); display.enableUTF8Print(); display.setFont(u8g2_font_unifont_t_arabic);

  // Language check
  preferences.begin("dev_store", false);
  currentLang = preferences.getInt("lang", -1);
  if (currentLang == -1) runLanguageSetup();

  loadStoredReceivers();

  // Try to connect to saved Wi-Fi
  String savedSSID = preferences.getString("ssid", "");
  String savedPASS = preferences.getString("pass", "");
  
  WiFi.mode(WIFI_STA);
  if (savedSSID != "") {
    display.clearBuffer(); display.setCursor(0, 30); display.print("Connecting WiFi..."); display.sendBuffer();
    WiFi.begin(savedSSID.c_str(), savedPASS.c_str());
    
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) { delay(500); retries++; }
  }

  // If connection fails or no credentials exist, start the Captive Portal
  if (WiFi.status() != WL_CONNECTED) {
    isCaptivePortalActive = true;
    
    display.clearBuffer();
    display.setCursor(0, 15); display.print("Connect to AP:");
    display.setCursor(0, 35); display.print("Smart Device Setup");
    display.setCursor(0, 55); display.print("To setup WiFi");
    display.sendBuffer();

    WiFi.mode(WIFI_AP);
    WiFi.softAP("Smart Device Setup");
    
    // Redirect all DNS requests to the ESP32 IP
    dnsServer.start(53, "*", WiFi.softAPIP());

    server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
      request->send_P(200, "text/html", index_html);
    });

    server.on("/save", HTTP_POST, [](AsyncWebServerRequest *request){
      String newSSID; String newPASS;
      if (request->hasParam("ssid", true)) newSSID = request->getParam("ssid", true)->value();
      if (request->hasParam("pass", true)) newPASS = request->getParam("pass", true)->value();

      preferences.begin("dev_store", false);
      preferences.putString("ssid", newSSID);
      preferences.putString("pass", newPASS);
      
      request->send(200, "text/html", "<h2>Credentials Saved. The device is restarting...</h2>");
      delay(2000);
      ESP.restart(); // Restart to connect as standard station
    });

    server.addHandler(new CaptiveRequestHandler());
    server.begin();

    // Infinite loop processing DNS requests. Device won't boot further until Wi-Fi is set.
    while(true) {
      dnsServer.processNextRequest();
      delay(10);
    }
  }

  // Wi-Fi is connected, proceed normally
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);

  if (esp_now_init() == ESP_OK) esp_now_register_send_cb(OnDataSent);

  renderMainMenu();
}

void loop() {
  if (isCaptivePortalActive) return; // Ignore loop if in portal mode

  unsigned long now = millis();
  manageConnections();

  bool currentDownState = digitalRead(BUTTON_DOWN_PIN);
  if (currentDownState == LOW && !isDownPressed) { isDownPressed = true; downPressTime = now; downHoldHandled = false; }
  
  if (isDownPressed) {
    if (currentDownState == LOW) {
      if (!downHoldHandled && (now - downPressTime >= HOLD_DURATION)) {
        downHoldHandled = true;
        if (receivers[selectedIndex].isConfigured) {
          receivers[selectedIndex].state = !receivers[selectedIndex].state;
          sendEspNowToReceiver(selectedIndex);
          if (client.connected() && receivers[selectedIndex].subTopic.length() > 0) {
            client.publish(receivers[selectedIndex].subTopic.c_str(), receivers[selectedIndex].state ? "1" : "0");
          }
          showDeviceActionScreen(selectedIndex);
        }
      }
    } else {
      if (!downHoldHandled) {
        int nextIdx = selectedIndex; bool found = false;
        for (int i = 1; i <= MAX_RECEIVERS; i++) {
          int checkIdx = (selectedIndex + i) % MAX_RECEIVERS;
          if (receivers[checkIdx].isConfigured) { nextIdx = checkIdx; found = true; break; }
        }
        if (found) { selectedIndex = nextIdx; renderMainMenu(); }
      }
      isDownPressed = false;
    }
  }

  bool currentUpState = digitalRead(BUTTON_UP_PIN);
  if (currentUpState == LOW && !isUpPressed) { isUpPressed = true; upPressTime = now; upHoldHandled = false; }
  
  if (isUpPressed) {
    if (currentUpState == LOW) {
      if (!upHoldHandled && (now - upPressTime >= HOLD_DURATION)) {
        upHoldHandled = true;
        if (receivers[selectedIndex].isConfigured) {
          if (client.connected()) {
            StaticJsonDocument<128> doc; doc["index"] = selectedIndex; doc["source"] = "esp32";
            char buffer[128]; serializeJson(doc, buffer); client.publish(delete_topic, buffer);
          }
          deleteReceiverFromNVS(selectedIndex);
          display.clearBuffer(); display.setCursor(15, 35); display.print(getDisplayText("DEVICE DELETED", "تم الحذف").c_str()); display.sendBuffer(); delay(1000);
          selectedIndex = 0; renderMainMenu();
        }
      }
    } else {
      if (!upHoldHandled) {
        int prevIdx = selectedIndex; bool found = false;
        for (int i = 1; i <= MAX_RECEIVERS; i++) {
          int checkIdx = (selectedIndex - i + MAX_RECEIVERS) % MAX_RECEIVERS;
          if (receivers[checkIdx].isConfigured) { prevIdx = checkIdx; found = true; break; }
        }
        if (found) { selectedIndex = prevIdx; renderMainMenu(); }
      }
      isUpPressed = false;
    }
  }

  if (now - lastHeartbeat >= heartbeatInterval) {
    lastHeartbeat = now;
    for (int i = 0; i < MAX_RECEIVERS; i++) { if (receivers[i].isConfigured) sendEspNowToReceiver(i); }
  }
}