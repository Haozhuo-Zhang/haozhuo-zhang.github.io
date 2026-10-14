import createGlobe from "./cobe.js";

var canvas = document.getElementById("visitor-globe");
if (canvas) mount(canvas);

function mount(canvas) {
  var probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = Math.max(canvas.clientWidth, 280);
  var places = [];
  var focus = null;
  var phi = 0.55;
  var theta = 0.28;
  var velocity = 0;
  var dragging = false;
  var pointer = null;
  var aimed = false;

  var globe = createGlobe(canvas, {
    devicePixelRatio: dpr,
    width: width,
    height: width,
    phi: phi,
    theta: theta,
    dark: 1,
    diffuse: 1.35,
    mapSamples: width < 460 ? 9000 : 16000,
    mapBrightness: 6.4,
    mapBaseBrightness: 0.04,
    baseColor: [0.72, 0.78, 0.86],
    markerColor: [0.98, 0.2, 0.16],
    glowColor: [0.55, 0.36, 0.2],
    markerElevation: 0.02,
    scale: 1,
    opacity: 1,
    markers: []
  });

  apply(window.hzVisits || { places: [], latest: null });
  window.addEventListener("hz-visits", function (event) { apply(event.detail || {}); });

  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("keydown", onKey);
  window.addEventListener("resize", measure);
  requestAnimationFrame(frame);
  canvas.classList.add("is-ready");

  function apply(detail) {
    places = Array.isArray(detail.places) ? detail.places : [];
    focus = detail.latest || null;
    if (!aimed && focus) {
      phi = -Math.PI / 2 - focus.lng * Math.PI / 180;
      aimed = true;
    }
  }

  function measure() {
    width = Math.max(canvas.clientWidth || canvas.offsetWidth || 280, 1);
  }

  function markers(now) {
    return places.map(function (place) {
      var size = 0.058 + Math.min(0.045, Math.log2(place.n + 1) * 0.014);
      var latest = focus
        && Math.abs(place.lat - focus.lat) < 0.08
        && Math.abs(place.lng - focus.lng) < 0.08;
      if (latest && !reduced) size *= 1 + 0.32 * Math.sin(now / 280);
      return {
        location: [place.lat, place.lng],
        size: size,
        color: [0.98, 0.18, 0.14]
      };
    });
  }

  function frame(now) {
    measure();
    if (!dragging) {
      if (!reduced) phi += 0.00135;
      phi += velocity;
      velocity *= 0.92;
      if (Math.abs(velocity) < 0.00005) velocity = 0;
    }
    globe.update({
      phi: phi,
      theta: theta,
      width: width,
      height: width,
      markers: markers(now)
    });
    requestAnimationFrame(frame);
  }

  function onDown(event) {
    dragging = true;
    pointer = { x: event.clientX, y: event.clientY };
    velocity = 0;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  }

  function onMove(event) {
    if (!dragging || !pointer) return;
    var dx = event.clientX - pointer.x;
    var dy = event.clientY - pointer.y;
    pointer = { x: event.clientX, y: event.clientY };
    var step = dx / 280;
    phi += step;
    velocity = step;
    theta = Math.max(-0.2, Math.min(0.85, theta - dy / 460));
  }

  function onUp() {
    dragging = false;
    pointer = null;
    canvas.classList.remove("is-dragging");
  }

  function onKey(event) {
    if (event.key === "ArrowLeft") phi -= 0.18;
    else if (event.key === "ArrowRight") phi += 0.18;
    else if (event.key === "ArrowUp") theta = Math.max(-0.2, theta - 0.08);
    else if (event.key === "ArrowDown") theta = Math.min(0.85, theta + 0.08);
    else return;
    event.preventDefault();
  }
}
