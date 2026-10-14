/* Records a city-level visit, shared by the homepage and project pages. */
(function () {
  var APP = "qu5p7nl9";
  var ROOT = "https://keyvalue.immanuel.co/api/KeyVal";
  var SHARDS = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  var CAP = 36;
  var CACHE = "hz-visits-v1";

  var state = readCache();
  window.hzVisits = state;
  renderStat();

  window.hzVisits.ready = boot();

  function emit() {
    renderStat();
    window.dispatchEvent(new CustomEvent("hz-visits", { detail: state }));
  }

  async function boot() {
    var loaded = null;
    try {
      loaded = await loadShards();
      state.places = publish(flatten(loaded));
      state.latest = await loadMeta();
      writeCache();
      emit();
    } catch (err) {
      loaded = null;
    }

    var place = await locate();
    if (!place) return;
    if (seenToday()) return;

    var base = loaded || shardsFromPublic(state.places);
    var optimistic = apply(cloneShards(base), place).shards;
    state.places = publish(flatten(optimistic));
    state.latest = latestFrom(place);
    emit();

    markToday();
    try {
      var saved = await commit(place);
      state.places = publish(flatten(saved));
      state.latest = await writeMeta(place);
      writeCache();
      emit();
    } catch (err) {
      unmarkToday();
    }
  }

  function siteName() {
    var host = location.hostname.toLowerCase();
    var seg = location.pathname.split("/").filter(Boolean)[0] || "";
    if (host.endsWith("github.io")) return seg || "home";
    return "home";
  }

  function dedupeKey() {
    return "hz-visit:" + siteName() + ":" + new Date().toISOString().slice(0, 10);
  }

  function seenToday() {
    try {
      return localStorage.getItem(dedupeKey()) === "1";
    } catch (err) {
      return false;
    }
  }

  function markToday() {
    try { localStorage.setItem(dedupeKey(), "1"); } catch (err) {}
  }

  function unmarkToday() {
    try { localStorage.removeItem(dedupeKey()); } catch (err) {}
  }

  function readCache() {
    try {
      var data = JSON.parse(localStorage.getItem(CACHE) || "null");
      if (!data || !Array.isArray(data.places)) return { places: [], latest: null };
      return { places: data.places, latest: data.latest || null };
    } catch (err) {
      return { places: [], latest: null };
    }
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE, JSON.stringify({ places: state.places, latest: state.latest }));
    } catch (err) {}
  }

  function renderStat() {
    var el = document.getElementById("globe-stat");
    if (!el) return;
    var places = state.places || [];
    var count = places.length;
    if (!count) {
      el.textContent = "Visits will show up here as red points.";
      return;
    }
    var visits = places.reduce(function (sum, place) { return sum + place.n; }, 0);
    var text = count === 1 ? "1 city" : count + " cities";
    if (visits !== count) text += " · " + (visits === 1 ? "1 visit" : visits + " visits");
    if (state.latest && state.latest.label) text += " · latest in " + state.latest.label;
    el.textContent = text;
  }

  async function locate() {
    var sources = [
      "https://get.geojs.io/v1/ip/geo.json",
      "https://ipwho.is/"
    ];
    for (var i = 0; i < sources.length; i++) {
      try {
        var data = await getJson(sources[i]);
        if (data && data.success === false) continue;
        var lat = Number(data.latitude);
        var lng = Number(data.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        if (lat === 0 && lng === 0) continue;
        return { lat: lat, lng: lng, city: data.city, country: data.country };
      } catch (err) {}
    }
    return null;
  }

  async function commit(place) {
    var last = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      var before = await loadShards();
      var result = apply(cloneShards(before), place);
      var want = findPoint(flatten(result.shards), place);
      await Promise.all(result.dirty.map(function (index) {
        return putKey(SHARDS[index], serialize(result.shards[index]));
      }));
      var after = await loadShards();
      var got = findPoint(flatten(after), place);
      last = after;
      if (got && want && got.n >= want.n) return after;
      await sleep(120 * (attempt + 1));
    }
    if (!last) throw new Error("save");
    return last;
  }

  function apply(shards, place) {
    var lat = Math.round(place.lat * 10);
    var lng = Math.round(place.lng * 10);
    var day = Math.floor(Date.now() / 86400000);
    var dirty = [];
    for (var i = 0; i < shards.length; i++) {
      var hit = shards[i].find(function (point) { return point.lat === lat && point.lng === lng; });
      if (hit) {
        hit.n += 1;
        hit.day = day;
        return { shards: shards, dirty: [i] };
      }
    }
    var target = 0;
    for (var j = 1; j < shards.length; j++) {
      if (shards[j].length < shards[target].length) target = j;
    }
    if (shards[target].length >= CAP) {
      var quiet = quietest(shards);
      shards[quiet.shard].splice(quiet.index, 1);
      dirty.push(quiet.shard);
    }
    shards[target].push({ lat: lat, lng: lng, n: 1, day: day });
    dirty.push(target);
    return { shards: shards, dirty: unique(dirty) };
  }

  function quietest(shards) {
    var best = { shard: 0, index: 0, n: Infinity, day: Infinity };
    shards.forEach(function (list, shard) {
      list.forEach(function (point, index) {
        if (point.n < best.n || (point.n === best.n && point.day < best.day)) {
          best = { shard: shard, index: index, n: point.n, day: point.day };
        }
      });
    });
    return best;
  }

  function findPoint(list, place) {
    var lat = Math.round(place.lat * 10);
    var lng = Math.round(place.lng * 10);
    for (var i = 0; i < list.length; i++) {
      if (list[i].lat === lat && list[i].lng === lng) return list[i];
    }
    return null;
  }

  async function loadShards() {
    var raw = await Promise.all(SHARDS.map(getKey));
    if (raw.some(function (value) { return value == null; })) throw new Error("load");
    return raw.map(parseShard);
  }

  function parseShard(raw) {
    if (!raw || raw === "-") return [];
    var points = [];
    raw.split(";").forEach(function (part) {
      var bits = part.split(",");
      if (bits.length < 3) return;
      var lat = Number(bits[0]);
      var lng = Number(bits[1]);
      var n = Number(bits[2]);
      var day = Number(bits[3] || 0);
      if (!Number.isInteger(lat) || lat < -900 || lat > 900) return;
      if (!Number.isInteger(lng) || lng < -1800 || lng > 1800) return;
      if (!Number.isInteger(n) || n < 1 || n > 1000000) return;
      points.push({ lat: lat, lng: lng, n: n, day: Number.isInteger(day) ? day : 0 });
    });
    return points;
  }

  function serialize(list) {
    if (!list.length) return "-";
    return list.map(function (point) {
      return point.lat + "," + point.lng + "," + point.n + "," + point.day;
    }).join(";");
  }

  function flatten(shards) {
    return shards.reduce(function (all, list) { return all.concat(list); }, []);
  }

  function cloneShards(shards) {
    return shards.map(function (list) {
      return list.map(function (point) {
        return { lat: point.lat, lng: point.lng, n: point.n, day: point.day };
      });
    });
  }

  function shardsFromPublic(places) {
    var shards = SHARDS.map(function () { return []; });
    (places || []).forEach(function (place, index) {
      shards[index % shards.length].push({
        lat: Math.round(place.lat * 10),
        lng: Math.round(place.lng * 10),
        n: place.n,
        day: place.day || 0
      });
    });
    return shards;
  }

  function publish(list) {
    return list.map(function (point) {
      return { lat: point.lat / 10, lng: point.lng / 10, n: point.n, day: point.day };
    });
  }

  function latestFrom(place) {
    var label = labelFor(place);
    if (!label) return null;
    return {
      label: label,
      lat: Math.round(place.lat * 10) / 10,
      lng: Math.round(place.lng * 10) / 10
    };
  }

  function labelFor(place) {
    var city = clean(place.city);
    var country = clean(place.country);
    return [city, country].filter(Boolean).join(", ");
  }

  function clean(value) {
    return String(value || "")
      .replace(/[^\p{L}\p{M}\s.'’-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
  }

  async function loadMeta() {
    var raw = await getKey("m");
    if (!raw || raw === "-") return null;
    var parts = raw.split("|");
    if (parts.length < 3) return null;
    var lng = Number(parts.pop());
    var lat = Number(parts.pop());
    var label = parts.join("|").trim();
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { label: label, lat: lat / 10, lng: lng / 10 };
  }

  async function writeMeta(place) {
    var latest = latestFrom(place);
    if (!latest) return null;
    var value = latest.label + "|" + Math.round(latest.lat * 10) + "|" + Math.round(latest.lng * 10);
    await putKey("m", value);
    return latest;
  }

  async function getKey(key) {
    try {
      var response = await fetch(ROOT + "/GetValue/" + APP + "/" + key, { cache: "no-store" });
      if (!response.ok) return null;
      var data = await response.json();
      return typeof data === "string" ? data : "";
    } catch (err) {
      return null;
    }
  }

  async function putKey(key, value) {
    var response = await fetch(
      ROOT + "/UpdateValue/" + APP + "/" + key + "/" + encodeURIComponent(value),
      { method: "POST", cache: "no-store" }
    );
    if (!response.ok) throw new Error("write");
  }

  async function getJson(url) {
    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function unique(values) {
    return values.filter(function (value, index) { return values.indexOf(value) === index; });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
})();
