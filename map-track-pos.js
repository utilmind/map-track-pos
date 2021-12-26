// ================
// ES6
// import mapboxgl from "mapbox-gl";

// ================
// ES5

(function(undefined) {
    var defStorageName = "map-pos",
        defIsCenterZoom = true, // FALSE = positioning by NExSW points. TRUE = positioning by central point + zoom level.
        hashDelimiter = "&", // we preserve everything in hash line after the first occurance of this delimiter. Set it to FALSE to not use it.

        storagePriorityMs = 5000, // milliseconds. // AK 11.12.2021: if page refreshed (by F5 for example), #hash in the address line not updating immediately. So coordinates in storage should have higher priority during N ms.

        isVisible = function(el) {
            return 0 < el.offsetWidth; // it's better than jQuery's selector is(":visible"). Invisible elements have 0 offsetWidth and offsetHeight.
        },

        updateHash = function(hash, noHashline) {
            /* AK: commented because there is no real usage for this event.
                // just dispatchEvent compatible with IE. If you don't need IE -- no need to use it.
                var ieEvent = function(targetObj,  // window, document, etc
                                        eventName, // string
                                        params) {  // any type
                        var event;

                        if ("function" === typeof Event) { // modern browsers
                            event = new CustomEvent(eventName, params ? { detail: params } : null);
                        }else { // IE
                            event = document.createEvent("CustomEvent");
                            event.initEvent(eventName, true, true, targetObj);
                            if (params) event.detail = params;
                        }
                        targetObj.dispatchEvent(event);
                    };
                ieEvent(window, "map-track-pos", hash);
            */

            if (hash && !noHashline) {
                if (hashDelimiter) {
                    var i, existingHash = location.hash; // remove first # from existing hash
                    if (existingHash && (-1 !== (i = existingHash.indexOf(hashDelimiter)))) {
                        hash+= existingHash.substr(i);
                    }
                }

                // WARNING 11.12.2021: #hash updates not immediately. If browser window receives "beforeunload", the #hash updating to late to be actually updated before the page refresh.
                // So we're setting up the kludge, timestamp of last occurance of "beforeunload", to use value in localStorage as priority.

                history.replaceState(null, null, location.origin + location.pathname + location.search + "#" + hash);
            }
            // WARNING: On 13.02.2021 cursor flicker on replaceState(). Changes to default state for a moment. This is known bug described at https://bugs.chromium.org/p/chromium/issues/detail?id=1128213
            // StackOverflow discussion: https://stackoverflow.com/questions/35524886/custom-cursor-blinking-when-using-window-history-replacestate
        },

        // MapBox only! (AK: we have duplicate in "map-export.js")
        // It's map.getBounds(), when both Bearing and Pitch is 0. This is quite good way to save and restore exact bounding box.
        getStraightBounds = function(map) {
            var saveBearing = map.getBearing(),
                savePitch = map.getPitch(),
                isTilt = 0 !== saveBearing || 0 !== savePitch,
                resultBounds;

            if (isTilt) {
                // AK 28.01.2021: I wish we could cancel bubbling on the "moveend" event! But we can't. :(
                // So let's cancel handling of the event in their handlers. We'll watch for _busyStraightBounds property.
                // map.on("moveend", stopPrpagationEvent);

                map._busyStraightBounds = true; // MUTATION of map. will help us to block odd "moveend"/"zoomend" events
                map.setBearing(0)
                    .setPitch(0);
            }
            resultBounds = map.getBounds();
            if (isTilt) {
                map.setBearing(saveBearing)
                    .setPitch(savePitch);
                map._busyStraightBounds = false; // MUTATION of map.
            }

            return resultBounds;
        },

        getViewportInfo = function(map, // either map, or string argument (#hashline)
            // if this argument has string type, we're retrieving parameters from the string, instead of map
                                needBounds) { // OR isLeaflet, in case if map (1st argument) is a #hashline.
                                              // Negative value (-1) returns straightBounds (supported in mapBox only)
            var rslt, bounds, boundsArr,
                isRecover = "string" === typeof map;

            // getting from input string...
            if (isRecover) {
                var isLeaflet = needBounds,
                    getCoordVal = function(index, expectingLastChar) {
                        var r = 0;
                        return ((undefined !== map[index]) &&
                                (expectingLastChar === map[index].charAt(map[index].length-1).toLowerCase()) &&
                                (r = map[index].slice(0, -1)) &&
                                !isNaN(r)) ? r : 0;
                    },

                    // returns fixed lng or FALSE if incorrect format.
                    isValidLatLng = function(lat, lng) {
                        // AK 11.08.2020: TODO watch limitRegionBounds and do autoCenterBounds.
                        if (lat < -86 || lat > 86) { // actually 90, but it's center.
                            return false; // incorrect coordinates
                        }

                        if (lng < -180)
                            lng = lng % 360 + 360;
                        else if (lng > 180)
                            lng = lng % 360 - 360;

                        return lng;
                    };

                // remove everything after delimiter first.
                if (hashDelimiter && (-1 !== (rslt = map.indexOf(hashDelimiter))))
                    map = map.substr(0, rslt);

                if ((map = map.split(",")) &&
                    (2 < map.length) &&
                    !isNaN(map[0]) &&
                    (!isNaN(map[1]) || (rslt = map[1].indexOf("x")))) {

                    // it's NE/SW (or NW/SE) coordinates?
                    if (needBounds = 0 < rslt) { // -1 = not found. But we don't need 0 either.
                        rslt = map[1].split("x");
                        if (isNaN(rslt[0]) || isNaN(rslt[1]) || isNaN(map[2]))
                            return false; // invalid format

                        var latNE = map[0], // don't be confused. It's mapBox-style points. For Leaflet we're using NW/SE.
                            lngNE = isValidLatLng(latNE, rslt[0]),
                            latSW = rslt[1],
                            lngSW = isValidLatLng(latSW, map[2]);

                        if (!lngNE || !lngSW)
                            return false;  // incorrect lattitude

                        if (isLeaflet) {
                            rslt = {
                                bounds: /*L.latLngBounds(*/[ // latLng for Leaflet (BTW it's actually NW/SE)
                                            [latNE, lngNE],
                                            [latSW, lngSW]
                                        ],
                                latNW: latNE,  // attention! NW/SE for Leaflet.
                                lngNW: lngNE,
                                latSE: latSW,
                                lngSE: lngSW
                            };
                        }else {
                            boundsArr = [ // lngLat for MapBox.
                                          [lngNE, latNE], // new mapboxgl.LngLat(lngNE, latNE)
                                          [lngSW, latSW] // new mapboxgl.LngLat(lngSW, latSW)
                                        ];
                            rslt = { // (we need initialized rslt anyway)
                                bounds: new mapboxgl.LngLatBounds(boundsArr)
                            }
                        }

                    }else {
                        var lat = map[0],
                            lng = isValidLatLng(lat, map[1]);

                        if (!lng)
                            return false; // incorrect lattitude

                        rslt = {
                            center: isLeaflet
                                ? [lat, lng]  // latLng for Leaflet
                                : [lng, lat], // lngLat for MapBox
                            zoom: getCoordVal(2, "z"),
                            lat: lat,
                            lng: lng
                        };
                    }

                    // finalize restoration. MapBox only. Both centered and 2-point positioning.
                    if (!isLeaflet) {
                        rslt.pitch = getCoordVal(
                            (rslt.bearing = getCoordVal(3, "b")) // b = bearing
                                ? 4 // if bearing specified, use 4th value.
                                : 3 // No bearing? Use 3rd.
                            , "p"); // p = pitch
                    }
                }else
                    return false; // incorrect format

            }else { // map must be specified
                var isLeaflet = (undefined === map.getPitch),
                // getting from map... "center" and "zoom" is universal for both Leaflet and MapBox.
                    center = map.getCenter(),
                    zoom = map.getZoom(),
                    lastView = map._lastViewport;

                rslt = {
                    zoom: zoom,
                    center: center, // L.latLng in Leaflet
                    lat: center.lat,
                    lng: center.lng,

                    // isMoved = whether it was moved since previous call of the trackViewport()
                    // This can be used in moveend/zoomend events to make sure whether the map was really moved.
                    // Unfortunately moveend/zoomend in MapBox may be triggered just because the map container become visible on the page.
                    // AND if map._lastViewport is not present, then map not moved. Then we just seeing restored state.
                    isMoved: lastView && (center.lat !== lastView.lat || center.lng !== lastView.lng || zoom !== lastView.zoom),
                };

                if (needBounds) {
                    bounds = rslt.bounds = map.getBounds(); // this also works both for Leaflet and MapBox.
                    if (isLeaflet) {
                        var nw = bounds.getNorthWest(),
                            se = bounds.getSouthEast();

                        rslt.latNW = nw.lat;  // attention! NW/SE for Leaflet, but NE/SW for MapBox!
                        rslt.lngNW = nw.lng;
                        rslt.latSE = se.lat;
                        rslt.lngSE = se.lng;
                    }
                }

                if (!isLeaflet) {
                    rslt.bearing = map.getBearing(),
                    rslt.pitch = map.getPitch();
                }
            }

            if (!isLeaflet && needBounds) { // continue mutation. Mapbox only.
                if (!isRecover) // when we restoring saved position, we already have boundsArr
                    boundsArr = bounds.toArray();

                rslt.latNE = boundsArr[0][1]; // swap
                rslt.lngNE = boundsArr[0][0]; // attention! NW/SE for Leaflet, but NE/SW for MapBox!
                rslt.latSW = boundsArr[1][1];
                rslt.lngSW = boundsArr[1][0];

                if (isRecover || 0 > needBounds) { // -1 == need straightBounds too
                    // get straight bounds or just copy existing values...
                    if (!isRecover && (0 !== rslt.bearing || 0 !== rslt.pitch)) { // need straightBounds
                        bounds = getStraightBounds(map);
                        boundsArr = bounds.toArray();
                    }

                    rslt.straightBounds = bounds;
                    rslt.slatNE = boundsArr[0][1];
                    rslt.slngNE = boundsArr[0][0];
                    rslt.slatSW = boundsArr[1][1];
                    rslt.slngSW = boundsArr[1][0];
                }
            }

            // AK: I don't want to use Object.assign() and still want this code on IE. So let's simply mutate result object.
            rslt.toString = function(isCenterZoom) {
                var v = this,
                    hasBounds = v.latNE || v.latNW;

                if (v.lat || hasBounds) // if have coordinates to show
                    return (!hasBounds || (isCenterZoom && v.lat)
                                  // isCenterZoom:
                                ? v.lat + "," + v.lng + "," + v.zoom + "z"
                                  // 2-points:
                                : (undefined === v.slatNE // it's Leaflet or MapBox?
                                    ? v.latNW + "," + v.lngNW + "x" + v.latSE + "," + v.lngSE // Leaflet use NW x SE
                                    : v.slatNE + "," + v.slngNE + "x" + v.slatSW + "," + v.slngSW // MapBox use NE x SW
                                  )) +
                        (v.bearing ? "," + v.bearing + "b" : "") +
                        (v.pitch ? "," + v.pitch + "p" : "");
            }

            return rslt;
        },

        trackViewport = function(map, isCenterZoom, storageName, noHashline) {
            if (!map._busyStraightBounds && // if not busy
                isVisible(map.getContainer())) { // fortunately getContainer() works both for Leaflet and MapBox

                if (undefined === isCenterZoom)
                    isCenterZoom = defIsCenterZoom;

                var vi = getViewportInfo(map, isCenterZoom ? false : -1), // -1 = need straightBounds
                    vis = vi.toString(isCenterZoom);

                if (vis !== map._lastVStr) { // update only if coordinates changed.
                    updateHash(vis, noHashline);

                    if (undefined === storageName || storageName) { // if not FALSE/NULL/"".
                        try {
                            // AK 14.05.2021: we don't using any replacement for localStorage here. We trying to use localStorage, but doing nothing if it fails (eg on Brave browser).
                            // AK 11.12.2021: adding timestamp at the end. So if page refreshed in less than N(5?) seconds, value in storage should have higher priority, because #hash in the address bar updating not immediately, or not updating on page refresh.
                            localStorage.setItem(storageName || defStorageName, vis + "|" + new Date().getTime()); // + timestamp
                        }catch(err) {
                            // console.error("Can't write to localStorage."); // localStorage blocked by paranoiac browser, like Brave with default settings
                        }
                    }

                    // MUTATIONS of map object.
                    map._lastViewport = vi;
                    map._lastVStr = vis;
                }

                // return viewPortInfo. Let the Viewport Info to be reused in the MapBox implementation.
                return vi;
            }
        },

        restoreViewport = function(defViewport, isCenterZoom, storageName, noHashline, isLeaflet) {
            /* Extra OPTIONS (in addition to standard OPTIONS of the setView()):
                storageName: (string). Name of storage item to save current map position and restore it on refresh. Any non-string TRUE will use default storage item name, specified by defStorageName variable.
                trackHashline: (boolean). If TRUE -- track current map position and zoom level (+ bearning & pitch in MapBox).
            */
            var vi, ts,
                hashCoords = noHashline ? false : location.hash; // get from the browser address line

            // checking localStorage first in either case, because for N seconds value in storage have higher prioerity. (Because #hash in the address line not refreshing on page refresh.)
            try {
                // AK 14.05.2021: we don't using any replacement for localStorage here. We trying to use localStorage, but doing nothing if it fails (eg on Brave browser).
                if ((storageName = localStorage.getItem(storageName || defStorageName)) && // if we successfully received data from localStorage (and nothing blocked our request)
                        (storageName = storageName.split("|"))) { // split coordinates and timestamp
                    ts = parseInt(storageName[1]); // timestamp. Must be integer.
                    storageName = storageName[0]; // coordinates
                }

            }catch(err) {
                // console.error("Can't read from localStorage."); // localStorage blocked by paranoiac browser, like Brave with default settings
            }

            if ((!ts || (ts + storagePriorityMs < new Date().getTime())) && // ts must be integer.
                    hashCoords && ("#" === hashCoords.charAt(0))) {

                if (vi = getViewportInfo(hashCoords.substr(1), isLeaflet))
                    vi.restored = "hash";

            }else if (storageName) {
                if (vi = getViewportInfo(storageName, isLeaflet))
                    vi.restored = "storage";

                // restore hashline, if it's used. At least trigger event.
                if (undefined === isCenterZoom)
                    isCenterZoom = defIsCenterZoom;

                if (vi)
                    updateHash(vi.toString(isCenterZoom), noHashline);
            }

            return vi || defViewport;
        },

        latLngToStr = function(latLng) {
            var lat = latLng.lat || latLng[0],
                lng = latLng.lng || latLng[1];

            return Math.abs(lat.toFixed(3)) + "°" + (lat > 0 ? "N" : "S") + " / " +
                   Math.abs(lng.toFixed(3)) + "°" + (lng > 0 ? "E" : "W");
        };


    if ("object" === typeof L) { // if we have Leaflet -- gracefully set up as Leaflet plugin.
        L.Map.include({

            // @public variable
            isViewportRestored: false, // FALSE if viewport did not restored from storage or from hash. Returns either "hash" or "storage" if viewport has been restored.

            // @public functions
            isVisible: function() { // Side method. I want to have it too, for other stuff.
                return isVisible(this.getContainer());
            },

            getViewportInfo: function(needBounds, // if 1st argument has string type, we're retrieving parameters from the string, instead of map
                                    bounds) { // custom bounds can be used to specify something totally custom, eg straightBounds (without pitch and bearing for the MapBox).
                return getViewportInfo(this, needBounds, bounds);
            },

            // WARNING: list of parameters DIFFERS from MapBox version!
            // IMPORTANT!! Must be called only once per map object. Otherwise events will be hooked more than once.
            // We don't checking whether events are hooked already, please just don't call restoreViewport() multiple times!
            restoreViewport: function(defCenter, defZoom, options) {
                // Options are the same as in setView() with following additions:
                //    storageName -- custom name of storage item to store current map position. Any TRUE but non-string value will use default storage item name, from "defStorageName" variable.
                //    noHashline -- set to TRUE to not restore/track map position in the hash section of the browser address line.
                if (!options) options = {};

                var map = this,
                    isCenterZoom = (undefined === options.isCenterZoom ? defIsCenterZoom : options.isCenterZoom),
                    vi = restoreViewport(false, isCenterZoom, options.storageName, options.noHashline, 1);

                if (vi) {
                    map.isViewportRestored = vi.restored;

                    if (vi.zoom) { // not specified if !isCenterZoom
                        defCenter = vi.center;
                        defZoom = vi.zoom;
                    }
                }

                if (options && (!options.noHashline || options.storageName)) {
                    // IMPORTANT! We don't checking whether events are hooked already for this map object. Just don't call restoreViewport() multiple times per single map!
                    var trackViewportChanges = function() {
                            // we checking whether map is currently visible inside... If map is not visible, we don't updating viewport position.
                            trackViewport(map, isCenterZoom, options.storageName, options.noHashline);
                        };

                    map.on("moveend", trackViewportChanges); // AK: no need to hook zoomend. One "moveend" perfectly serves to us.
                    // AK: I reproduced situations when map still continue moving (with animation), but page is closing.
                    window.addEventListener("beforeunload", trackViewportChanges);
                }

                // Unfortunately we cannot set central point immediately when restoring bounding rectangle.
                // fitBounds() take little bit longer time internally than regular setView().
                // So the app should either:
                //    * WAIT for the rending of initial bounds after calling the fitBounds before any automatic moving to some position, OR
                //    * don't waste time to restore initial position with restoreViewport() in case if the viewport should be immediately switched to some other point.
                //
                if (vi && vi.bounds) {
                    // invalid bounds may cause fatal exception, so let's try to set it. If it fails, we'll set default center/zoom.
                    // Example of impossible coordinates: DOMAIN/#50.994743117903404,4.343719482421876x50.994743117903404,4.343719482421876
                    // No need to try to parse errorneous bounds. Let's just set default if anything fails by any reason.
                    try {
                        return map.fitBounds(vi.bounds);
                    }catch(e) {}
                }

                // defCenter / defZoom is restored point, if we restored it.
                return map.setView(defCenter, defZoom, options); // L.Map.prototype.setView.call()
            },

            latLngToStr: function(latLng) {
                return latLngToStr(latLng);
            },

        });

    }else { // *** MapBox ***
            // if there is no Leaflet (L-object), we consider that it's for the MapBox. Just add following GLOBAL functions...
            //   getViewportInfo() -- get current Viewport information.
            //       * use getViewportInfo().toString() to get the #hash line with coordinates.
            //   trackViewport()   -- hook "moveend" and "zoomend", save current position to localStorage
            //   restoreViewport() -- recover stored Viewport information from address line (hash) OR storage
            //   getStraightBounds() -- get visible viewport of the map (with getBounds()), but ignoring bearing and pitch.
            //   latLngToStr() -- human readable string with latitude + longitude.

        // alter existing static mapbox object. But scope can be "window" too.
        var scope = mapboxgl;

        scope.getViewportInfo = getViewportInfo; // (map, needBounds, bounds)
        scope.trackViewport   = trackViewport;   // (map, isCenterZoom, storageName, noHashline)
                                                 //       isCenterZoom -- select method how we track coordinates.
                                                 //                       FALSE = positioning by NExSW points. TRUE = positioning by central point + zoom level.
        // Get restored information. Returns viewportInfo, either center point + zoom OR ne/sw (bounds). Plus pitch and bearing in both cases.
        // Position can be applied on
        scope.restoreViewport = function(defViewport, isCenterZoom, storageName, noHashline) {
            return restoreViewport(defViewport, isCenterZoom, storageName, noHashline, 0); // 0 = not Leaflet.
        };
        // apply the viewportInfo (restored with restoreViewport function) into mapboxgl's map object.
        // Use only if viewport controlled by bounding rectangle! No need to use it if viewport controlled by central point + zoom.
        //
        // ALSO. Use applyViewport only when the map container's position are fully calculated. Otherwise, if it's display:none, coordinates can be not exactly the same when container become visible.
        // We don't checking here whether map are visible. We just applying position. Control the map visibility outside. (And do not apply when it's invisible.)
        // ...OR even better, initialize map only when container are visible.
        scope.applyViewport = function(map, vi) {
            if (vi.bounds) { // By default MapBox restore only central point + zoom. Let's fit the viewport to bounding rectangle instead.
                map.fitBounds(vi.bounds, { animate: false });
                // restore tilt & rotation after bounds anyway. It's straight bounds.
                if (vi.pitch) map.setPitch(vi.pitch); // it shouldn't be neither 0 nor undefined
                if (vi.bearing) map.setBearing(vi.bearing); // but negative values are possible
            }
        };
        scope.getStraightBounds = getStraightBounds;
        scope.latLngToStr = latLngToStr;
    }
})();