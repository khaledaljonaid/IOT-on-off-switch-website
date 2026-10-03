#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h> 
#include <Preferences.h>

const int ledPin   = 2; // Relay / Output Pin
const int blinkPin = 4; // Blinks while scanning, OFF when locked on

Preferences preferences;

// MUST MATCH SENDER STRUCT EXACTLY
typedef struct struct_message {
  uint8_t receiver_id;
  uint8_t state;
  uint8_t channel;
} struct_message;

struct_message myData;

volatile unsigned long lastPacketTime = 0;
bool isScanning = true;
int currentChannel = 1;
unsigned long lastScanTime = 0;
const unsigned long scanInterval = 150; // Channel hop speed (ms)

// Pin 4 Status LED Blinking
unsigned long lastBlinkTime = 0;
const unsigned long blinkInterval = 300; 
bool blinkState = false;

void OnDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
  uint8_t oldState = myData.state;
  memcpy(&myData, incomingData, sizeof(myData));
  
  // Update output hardware using state (1 = ON, 0 = OFF)
  digitalWrite(ledPin, myData.state ? HIGH : LOW);
  
  if (oldState != myData.state) {
    preferences.putBool("led_state", myData.state ? true : false);
  }
  
  lastPacketTime = millis();
  
  // Lock onto the channel supplied in packet
  if (myData.channel > 0 && myData.channel != currentChannel) {
    currentChannel = myData.channel;
    preferences.putUChar("last_chan", currentChannel); // Store locked channel to NVS
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE); 
    esp_wifi_set_promiscuous(false);
  }

  if (isScanning) {
    isScanning = false;
    digitalWrite(blinkPin, LOW); // Turn off blink indicator when locked
    Serial.print("\n🎯 LOCKED ON CHANNEL: ");
    Serial.println(currentChannel);
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(ledPin, OUTPUT);
  pinMode(blinkPin, OUTPUT);
  digitalWrite(blinkPin, LOW);
  
  preferences.begin("light-state", false);
  myData.state = preferences.getBool("led_state", false) ? 1 : 0;
  currentChannel = preferences.getUChar("last_chan", 1);
  digitalWrite(ledPin, myData.state ? HIGH : LOW);
  
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE); 
  esp_wifi_set_promiscuous(false);

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  
  esp_now_register_recv_cb(OnDataRecv);
  lastPacketTime = millis();
}

void loop() {
  unsigned long now = millis();
  
  // 1. Blink Pin 4 while searching for Sender channel
  if (isScanning) {
    if (now - lastBlinkTime >= blinkInterval) {
      lastBlinkTime = now;
      blinkState = !blinkState;
      digitalWrite(blinkPin, blinkState ? HIGH : LOW);
    }
  }

  // 2. Resume scanning if heartbeat missing for > 2.5 seconds
  if (now - lastPacketTime > 2500) {
    if (!isScanning) {
      isScanning = true;
      Serial.println("\n⚠️ Connection lost. Scanning channels...");
    }
    
    if (now - lastScanTime >= scanInterval) {
      lastScanTime = now;
      
      currentChannel++;
      if (currentChannel > 13) {
        currentChannel = 1;
      }
      
      esp_wifi_set_promiscuous(true);
      esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE); 
      esp_wifi_set_promiscuous(false);
    }
  }
}