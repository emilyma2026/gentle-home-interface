# Home navigation MVP

The `feature/home-navigation` branch adds the first real GPS and map layer while keeping the original demo fallback.

## Local map configuration

The Google Maps browser key is intentionally not committed. Put it in an environment variable and generate the ignored local config file:

```powershell
$env:VITE_GOOGLE_MAPS_API_KEY="your-key"
node scripts/gen-maps-config.mjs
```

The Google Cloud key should be restricted by allowed web origins and limited to the Maps JavaScript API and Directions API.

## Behavior

- Family setup can select home by clicking or dragging the map pin, or use the current device location.
- The elder device requests browser geolocation with `watchPosition`.
- Location state stores latitude, longitude, accuracy, timestamp, source, and status.
- Three consecutive real updates outside the configured radius are required before changing to a leaving/guiding state, which reduces GPS drift false alarms.
- The elder receives a TTS reminder when leaving the safe radius.
- The guide screen tries a Google walking route and extracts up to three short instructions. If Maps or Directions is unavailable, the existing landmark guide remains the fallback.
- The original virtual walk controls remain available for demo and development use.

Location is sensitive data. Use fictional demo coordinates during development, stop the watcher when leaving the elder flow, and do not commit generated map configuration files.
