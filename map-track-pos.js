(function() {
    var defCookieName = "map-pos",

        getCookie = function(name, def) {
            var i, c, ca = document.cookie.split(";"),
                nameEQ = name + "=";

            for (i = 0; i < ca.length; ++i) {
                c = ca[i].replace(/^\s+/, "");
                if (0 === c.indexOf(nameEQ))
                    return unescape(c.substr(nameEQ.length));
            }
            return def;
        },

        setCookie = function(name, value, expireSecs) { // to clear cookie set value to "". No value = no cookie.
            var expireStr = "";
            if ("" != value) { // value can be boolean false, so don't do exact type comparison
              var t = new Date();
              t.setTime(t.getTime() + (expireSecs ? expireSecs * 1000 : 31536000000)); // 1 year if expiration time not specified
              expireStr = t.toGMTString();
            }

            document.cookie = name+"="+escape(value) +
               // cookie without expiration is session cookie
               (expireStr ? ";expires=" + expireStr : "") +
               ";path=/;samesite=strict" + // Since 14.12.2019 we serving only secure cookies and only on the same site. If you need something different -- write alternative implementation.
               (location.protocol === "https:" ? ";secure" : "");
        },

        isVisible = function(el) {
            return 0 < el.offsetWidth; // it's better than jQuery's selector is(":visible"). Invisible elements have 0 offsetWidth and offsetHeight.
        },

        getViewportInfo = function(map, // either map, or string argument (hashline)
            // if this argument has string type, we're retrieving parameters from the string, instead of map
                                needBounds, // isLeaflet, in case if map is hashline
                                bounds) { // custom bounds can be used to specify something totally custom, eg straightBounds (without pitch and bearing for the MapBox).
            var rslt;

            // getting from input string...
            if ("string" === typeof map) {
                var getCoordVal = function(index, expectingLastChar) {
                        var r = 0;
                        return (("undefined" !== typeof map[index]) &&
                                (expectingLastChar === map[index].charAt(map[index].length-1).toLowerCase()) &&
                                (r = map[index].slice(0, -1)) &&
                                !isNaN(r)) ? r : 0;
                    };

                if ((map = map.split(",")) &&
                    (2 < map.length) &&
                    !isNaN(map[0]) &&
                    !isNaN(map[1])) {

                    var lat = map[0],
                        lng = map[1];

                    // AK 11.08.2020: TODO watch limitRegionBounds and do autoCenterBounds.
                    if (lat < -86 || lat > 86) { // actually 90, but it's center.
                        return false; // incorrect coordinates
                    }

                    if (lng < -180)
                        lng = lng % 360 + 360;
                    else if (lng > 180)
                        lng = lng % 360 - 360;

                    rslt = {
                        center: needBounds // = isLeaflet
                            ? [lat, lng]  // latLng for Leaflet
                            : [lng, lat], // lngLat for MapBox
                        zoom: getCoordVal(2, "z"),
                        lat: lat,
                        lng: lng,
                    };

                    if (!needBounds) { // = !isLeaflet
                        rslt.bearing = getCoordVal(3, "b");
                        rslt.pitch = getCoordVal(4, "p");
                    }
                }else
                    return false; // incorrect format

            }else { // map must be specified
                var isLeaflet = "undefined" === typeof map.getPitch,
                // getting from map... "center" and "zoom" is universal for both Leaflet and MapBox.
                    center = map.getCenter(),
                    zoom = map.getZoom();

                if (needBounds && !bounds) bounds = map.getBounds();

                if (isLeaflet) { // LeafletJS
                    rslt = {
                        center: center, // L.latLng in Leaflet
                        zoom: zoom,
                        lat: center.lat,
                        lng: center.lng,
                    };

                    if (needBounds) {
                        var nw = bounds.getNorthWest(),
                            se = bounds.getSouthEast();

                        rslt.bounds = bounds;
                        rslt.latNW = nw.lat;
                        rslt.lngNW = nw.lng;
                        rslt.latSE = se.lat;
                        rslt.lngSE = se.lng;
                    }

                }else { // MapBoxGL
                    var centerArr = center.toArray();

                    rslt = {
                        center: center, // mapboxgl.LngLat in Mapbox
                        zoom: parseFloat(zoom),//.toFixed(2)
                        bearing: parseFloat(map.getBearing()),//.toFixed(2),
                        pitch: parseFloat(map.getPitch()),//.toFixed(2),
                        lat: parseFloat(centerArr[1]),//.toFixed(4),
                        lng: parseFloat(centerArr[0]),//.toFixed(4);
                    };

                    if (needBounds) {
                        var boundsArr = bounds.toArray();
                        rslt.bounds = bounds; // It's almost the same as map.getBounds(), but when Bearing and Pitch is 0. So we can easily restore everything to original state.
                        rslt.latNW = parseFloat(boundsArr[0][1]);
                        rslt.lngNW = parseFloat(boundsArr[0][0]);
                        rslt.latSE = parseFloat(boundsArr[1][1]);
                        rslt.lngSE = parseFloat(boundsArr[1][0]);
                    }
                }
            }

            // AK: I don't want to use Object.assign() and still want this code on IE.
            rslt.toString = function() {
                var v = this;
                return v.lat + "," + v.lng + "," + v.zoom + "z" +
                    (v.bearing ? "," + v.bearing + "b" : "") +
                    (v.pitch ? "," + v.pitch + "p" : "");
            }

            return rslt;
        },

        trackViewport = function(map, cookieName, noHashline) {
            if (isVisible(map.getContainer())) { // fortunately getContainer() works both for Leaflet and MapBox

                var vi = getViewportInfo(map), // return it. Let the Viewport Info to be reused in the MapBox implementation.
                    vis = vi.toString();

                if (!noHashline)
                    history.replaceState(null, null, location.origin + location.pathname + location.search + "#" + vis);

                if (cookieName)
                    setCookie("string" === typeof cookieName ? cookieName : defCookieName, vis);

                return vi;
            }
        },

        restoreViewport = function(defViewport, cookieName, noHashline, isLeaflet) {
            /* Extra OPTIONS (in addition to standard OPTIONS of the setView()):
                cookieName: (string). Name of cookie to save current map position and restore it on refresh. Any non-string TRUE will use default cookie name, specified by defCookieName variable.
                trackHashline: (boolean). If TRUE -- track current map position and zoom level (+ bearning & pitch in MapBox).
            */
            var vi,
                hashCoords = noHashline ? false : location.hash; // get from the browser address line

            // try to recover from the address line
            if (hashCoords && ("#" === hashCoords.charAt(0)))
                vi = getViewportInfo(hashCoords.substr(1), isLeaflet);

            // try to recover from cookie
            if (!vi && cookieName &&
                (cookieName = getCookie("string" === typeof cookieName ? cookieName : defCookieName)))
                vi = getViewportInfo(cookieName, isLeaflet);

            return vi || defViewport;
        };


    if ("object" === typeof L) { // if we have Leaflet -- gracefully set up as Leaflet plugin.
        L.Map.include({

            isVisible: function() { // Side method. I want to have it too, for other stuff.
                return isVisible(this.getContainer());
            },

            getViewportInfo: function(needBounds, // if 1st argument has string type, we're retrieving parameters from the string, instead of map
                                    bounds) { // custom bounds can be used to specify something totally custom, eg straightBounds (without pitch and bearing for the MapBox).
                return getViewportInfo(this, needBounds, bounds);
            },

            restoreViewport: function(defCenter, defZoom, options) {
                // Options are the same as in setView() with following additions:
                //    cookieName -- custom name of cookie to store current map position. Any TRUE but non-string value will use default cookie name, from "defCookieName" variable.
                //    noHashline -- set to TRUE to not restore/track map position in the hash section of the browser address line.
                if (!options) options = {};

                var map = this,
                    vi = restoreViewport(false, options.cookieName, options.noHashline, 1);

                if (vi) {
                    defCenter = vi.center;
                    defZoom = vi.zoom;
                }

                if (options) {
                    if (!options.noHashline || options.cookieName) {
                        map.on("moveend zoomend", function() { // we checking whether map is currently visible inside...
                            trackViewport(map, options.cookieName, options.noHashline);
                        });
                    }
                }

                return L.Map.prototype.setView.call(map, defCenter, defZoom, options);
            },
        });

    }else { // *** MapBox ***
            // if there is no Leaflet (L-object), we consider that it's for the MapBox. Just add following GLOBAL functions...
            //   1. mapGetViewportInfo() -- get current Viewport information
            //   2. mapTrackViewport()   -- hook "moveend" and "zoomend", save current position to cookies
            //   3. mapRecoverViewport() -- recover stored Viewport information from address line OR cookie

        // publish to global
        window.mapGetViewportInfo = getViewportInfo; // (map, needBounds, bounds)
        window.mapTrackViewport   = trackViewport;   // (map, cookieName, noHashline)
        window.mapRestoreViewport = function(defViewport, cookieName, noHashline) {     // (cookieName, noHasline)
            return restoreViewport(defViewport, cookieName, noHashline, 0);
        };
    }
})();
