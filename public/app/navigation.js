(function (window) {
  "use strict";

  var watchId = null;
  var mapsPromise = null;

  function error(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function distanceMeters(a, b) {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var lat1 = a.lat * rad;
    var lat2 = b.lat * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  }

  function bearingDegrees(a, b) {
    if (!a || !b) return null;
    var rad = Math.PI / 180;
    var y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    var x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function start(onPosition, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(error("unsupported", "当前设备不支持定位"));
      return false;
    }
    if (watchId !== null) return true;
    watchId = navigator.geolocation.watchPosition(onPosition, function (positionError) {
      if (onError) onError(error(positionError.code === 1 ? "permission_denied" : "position_failed", positionError.message || "定位失败"));
    }, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
    return true;
  }

  function stop() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  function locate(onPosition, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(error("unsupported", "当前设备不支持定位"));
      return;
    }
    navigator.geolocation.getCurrentPosition(onPosition, function (positionError) {
      if (onError) onError(error(positionError.code === 1 ? "permission_denied" : "position_failed", positionError.message || "定位失败"));
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }

  function loadMaps() {
    if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
    if (mapsPromise) return mapsPromise;
    var config = window.MAPS_CONFIG || {};
    if (!config.key) {
      console.warn("[Navigation] Maps API key missing. Set VITE_GOOGLE_MAPS_API_KEY or run scripts/gen-maps-config.mjs");
      return Promise.reject(error("maps_key_missing", "地图服务尚未配置"));
    }
    mapsPromise = new Promise(function (resolve, reject) {
      var callbackName = "__rememberUsMapsReady" + Date.now();
      window[callbackName] = function () {
        delete window[callbackName];
        resolve(window.google.maps);
      };
      var script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        delete window[callbackName];
        mapsPromise = null;
        console.warn("[Navigation] Maps JS API failed to load. Check: 1) API key restrictions (HTTP referrers) 2) Maps JavaScript API enabled in GCP 3) Billing enabled");
        reject(error("maps_failed", "地图服务加载失败"));
      };
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(config.key) + "&libraries=geometry,places&callback=" + callbackName;
      document.head.appendChild(script);
    });
    return mapsPromise;
  }

  function createMap(container, options) {
    options = options || {};
    return loadMaps().then(function (maps) {
      var center = options.center || { lat: 23.145, lng: 113.324 };
      var map = new maps.Map(container, {
        center: center,
        zoom: options.zoom || 16,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      var homeMarker = new maps.Marker({ map: map, position: center, title: options.homeTitle || "Home", draggable: true });
      var rangeCircle = options.radius ? new maps.Circle({
        map: map,
        center: center,
        radius: Number(options.radius) || 800,
        strokeColor: "#8A9A4E",
        strokeOpacity: 0.55,
        strokeWeight: 2,
        fillColor: "#8A9A4E",
        fillOpacity: 0.12,
        clickable: false,
      }) : null;
      var currentMarker = null;
      var landmarkMarkers = [];
      var routeRenderer = new maps.DirectionsRenderer({ map: map, suppressMarkers: false, preserveViewport: false });
      var directions = new maps.DirectionsService();
      function selectHome(point) {
        homeMarker.setPosition(point);
        if (rangeCircle) rangeCircle.setCenter(point);
        if (options.onHomeSelect) options.onHomeSelect({ lat: point.lat(), lng: point.lng() });
      }
      map.addListener("click", function (event) { selectHome(event.latLng); });
      homeMarker.addListener("dragend", function (event) { selectHome(event.latLng); });
      function clearLandmarks() {
        for (var i = 0; i < landmarkMarkers.length; i++) landmarkMarkers[i].setMap(null);
        landmarkMarkers = [];
      }
      function routeHome(point, home) {
        if (!point || !home) return Promise.reject(error("route_missing", "缺少路线起点或终点"));
        return new Promise(function (resolve, reject) {
          var origin = new maps.LatLng(point.lat, point.lng);
          var destination = new maps.LatLng(home.lat, home.lng);
          directions.route({ origin: origin, destination: destination, travelMode: maps.TravelMode.WALKING }, function (result, status) {
            if (status !== "OK") {
              console.error("[Navigation] Directions API failed. Status:", status, "Result:", result);
              if (status === "REQUEST_DENIED") console.error("-> Please enable 'Directions API' in Google Cloud Console.");
              if (status === "ZERO_RESULTS") console.error("-> No walking route found between", point, "and", home, "Distance might be too long or ocean crossing.");
              reject(error("route_failed", "暂时找不到步行路线"));
              return;
            }
            routeRenderer.setDirections(result);
            resolve(result.routes[0]);
          });
        });
      }
      return {
        setHome: function (point) {
          if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
          var position = new maps.LatLng(point.lat, point.lng);
          homeMarker.setPosition(position);
          if (rangeCircle) rangeCircle.setCenter(position);
          map.panTo(position);
        },
        setRadius: function (meters) {
          var r = Number(meters);
          if (!rangeCircle || !Number.isFinite(r) || r <= 0) return;
          rangeCircle.setRadius(r);
          var bounds = rangeCircle.getBounds();
          if (bounds) map.fitBounds(bounds);
        },
        setCurrent: function (point) {
          if (!point) return;
          if (!currentMarker) currentMarker = new maps.Marker({ map: map, position: point, title: options.currentTitle || "Current location", icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#C9646B", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } });
          else currentMarker.setPosition(point);
        },
        setLandmarks: function (places) {
          clearLandmarks();
          (places || []).forEach(function (place) {
            if (!place || !place.location || !Number.isFinite(place.location.lat) || !Number.isFinite(place.location.lng)) return;
            landmarkMarkers.push(new maps.Marker({
              map: map,
              position: place.location,
              title: place.name || "Nearby place",
              label: { text: "•", color: "#426A8C", fontSize: "22px", fontWeight: "700" },
            }));
          });
        },
        routeHome: routeHome,
      };
    });
  }

  function routeHome(point, home) {
    return createMap(document.createElement("div"), {}).then(function (controller) {
      return controller.routeHome(point, home);
    });
  }

  function placeText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value.text || value.value || "");
  }

  function placePoint(location) {
    if (!location) return null;
    var lat = typeof location.lat === "function" ? location.lat() : Number(location.lat);
    var lng = typeof location.lng === "function" ? location.lng() : Number(location.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  function findNearbyPlaces(center, options) {
    options = options || {};
    var point = placePoint(center);
    if (!point) return Promise.resolve([]);
    return loadMaps().then(function (maps) {
      return new Promise(function (resolve) {
        if (!maps.places || !maps.places.PlacesService) {
          resolve([]);
          return;
        }
        var dummy = document.createElement("div");
        var service = new maps.places.PlacesService(dummy);
        service.nearbySearch({
          location: point,
          radius: Math.min(Math.max(Number(options.radius) || 120, 50), 500),
          type: "point_of_interest"
        }, function (results, status) {
          if (status !== maps.places.PlacesServiceStatus.OK || !results) {
            resolve([]);
            return;
          }
          var limit = Math.min(Math.max(Number(options.maxResultCount) || 3, 1), 10);
          var mapped = results.slice(0, limit).map(function (place) {
            var location = placePoint(place.geometry && place.geometry.location);
            var photoUrl = "";
            if (place.photos && place.photos.length > 0) {
              photoUrl = place.photos[0].getUrl({ maxWidth: 400, maxHeight: 400 });
            }
            return {
              name: place.name || "",
              location: location,
              address: place.vicinity || place.formatted_address || "",
              primaryType: (place.types && place.types[0]) || "",
              types: place.types || [],
              mapsUrl: "",
              photoUrl: photoUrl
            };
          }).filter(function (p) { return p.name && p.location; });
          resolve(mapped);
        });
      });
    });
  }

  function geocodeAddress(address) {
    if (!String(address || "").trim()) return Promise.reject(error("address_missing", "缺少家庭地址"));
    return loadMaps().then(function (maps) {
      return new Promise(function (resolve, reject) {
        new maps.Geocoder().geocode({ address: String(address).trim(), region: "sg" }, function (results, status) {
          if (status !== "OK" || !results || !results[0]) { reject(error("geocode_failed", "找不到这个家庭地址")); return; }
          var location = results[0].geometry.location;
          resolve({ lat: location.lat(), lng: location.lng(), formattedAddress: results[0].formatted_address });
        });
      });
    });
  }

  window.Navigation = {
    start: start,
    stop: stop,
    locate: locate,
    loadMaps: loadMaps,
    createMap: createMap,
    routeHome: routeHome,
    geocodeAddress: geocodeAddress,
    findNearbyPlaces: findNearbyPlaces,
    distanceMeters: distanceMeters,
    bearingDegrees: bearingDegrees,
    isWatching: function () { return watchId !== null; },
  };
})(window);
