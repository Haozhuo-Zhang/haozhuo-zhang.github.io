function mount(canvas) {
  var gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return;
  gl.frontFace(gl.CW);

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var width = 280;
  var places = [];
  var yaw = -0.42;
  var pitch = 0.48;
  var spin = 0;
  var tilt = 0;
  var dragging = false;
  var pointer = null;

  var earth = program(gl, EARTH_VS, EARTH_FS);
  var glow = program(gl, GLOW_VS, GLOW_FS);
  var dots = program(gl, DOT_VS, DOT_FS);
  var sphere = sphereMesh(gl, 72, 144);
  var markerBuf = gl.createBuffer();
  var markerCount = 0;
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([14, 32, 54, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var mapReady = false;
  var image = new Image();
  image.onload = function () {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    mapReady = true;
  };
  image.src = new URL("./earth.png", import.meta.url).href;

  apply(window.hzVisits || { places: [] });
  window.addEventListener("hz-visits", function (event) { apply(event.detail || {}); });
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("keydown", onKey);
  requestAnimationFrame(frame);
  canvas.classList.add("is-ready");

  function apply(detail) {
    places = Array.isArray(detail.places) ? detail.places : [];
    var data = new Float32Array(places.length * 4);
    places.forEach(function (place, index) {
      var lat = place.lat * Math.PI / 180;
      var lng = place.lng * Math.PI / 180;
      var size = 7 + Math.min(7, Math.log2(place.n + 1) * 2.2);
      data[index * 4] = Math.cos(lat) * Math.sin(lng);
      data[index * 4 + 1] = Math.sin(lat);
      data[index * 4 + 2] = Math.cos(lat) * Math.cos(lng);
      data[index * 4 + 3] = size;
    });
    markerCount = places.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, markerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  function frame() {
    var next = Math.max(canvas.clientWidth || canvas.offsetWidth || 280, 1);
    if (next !== width || canvas.width !== Math.round(next * dpr)) {
      width = next;
      canvas.width = Math.round(width * dpr);
      canvas.height = canvas.width;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    if (!dragging) {
      if (!reduced) yaw += 0.0015;
      yaw += spin;
      pitch += tilt;
      spin *= 0.9;
      tilt *= 0.9;
      pitch = clamp(pitch, -0.5, 0.75);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    var rot = rotation(yaw, pitch);
    var proj = perspective(0.62, 1, 0.1, 20);

    gl.cullFace(gl.BACK);
    gl.useProgram(earth.program);
    gl.uniformMatrix3fv(earth.rot, false, rot);
    gl.uniformMatrix4fv(earth.proj, false, proj);
    gl.uniform1f(earth.cam, 3.75);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(earth.map, 0);
    bindSphere(earth.pos, earth.uv);
    gl.drawElements(gl.TRIANGLES, sphere.count, gl.UNSIGNED_SHORT, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.cullFace(gl.FRONT);
    gl.depthMask(false);
    gl.useProgram(glow.program);
    gl.uniformMatrix3fv(glow.rot, false, rot);
    gl.uniformMatrix4fv(glow.proj, false, proj);
    gl.uniform1f(glow.cam, 3.75);
    bindSphere(glow.pos, null);
    gl.drawElements(gl.TRIANGLES, sphere.count, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    if (!mapReady || !markerCount) return;
    gl.useProgram(dots.program);
    gl.uniformMatrix3fv(dots.rot, false, rot);
    gl.uniformMatrix4fv(dots.proj, false, proj);
    gl.uniform1f(dots.cam, 3.75);
    gl.uniform1f(dots.dpr, dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, markerBuf);
    gl.enableVertexAttribArray(dots.pos);
    gl.vertexAttribPointer(dots.pos, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(dots.size);
    gl.vertexAttribPointer(dots.size, 1, gl.FLOAT, false, 16, 12);
    gl.drawArrays(gl.POINTS, 0, markerCount);
  }

  function onDown(event) {
    dragging = true;
    pointer = { x: event.clientX, y: event.clientY };
    spin = 0;
    tilt = 0;
    canvas.classList.add("is-dragging");
    try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
  }

  function onMove(event) {
    if (!dragging || !pointer) return;
    var dx = event.clientX - pointer.x;
    var dy = event.clientY - pointer.y;
    pointer = { x: event.clientX, y: event.clientY };
    var step = Math.PI / Math.max(width, 280);
    yaw += dx * step;
    pitch = clamp(pitch + dy * step * 0.35, -0.5, 0.75);
    spin = dx * step;
  }

  function onUp() {
    dragging = false;
    pointer = null;
    canvas.classList.remove("is-dragging");
  }

  function onKey(event) {
    var step = 0.16;
    if (event.key === "ArrowLeft") yaw -= step;
    else if (event.key === "ArrowRight") yaw += step;
    else if (event.key === "ArrowUp") pitch = clamp(pitch - step * 0.35, -0.5, 0.75);
    else if (event.key === "ArrowDown") pitch = clamp(pitch + step * 0.35, -0.5, 0.75);
    else return;
    event.preventDefault();
  }

  function bindSphere(posLoc, uvLoc) {
    gl.bindBuffer(gl.ARRAY_BUFFER, sphere.positions);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);
    if (uvLoc != null) {
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphere.indices);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotation(yaw, pitch) {
  var cy = Math.cos(yaw);
  var sy = Math.sin(yaw);
  var cp = Math.cos(pitch);
  var sp = Math.sin(pitch);
  return new Float32Array([
    cy, sy * sp, -sy * cp,
    0, cp, sp,
    sy, -cy * sp, cy * cp
  ]);
}

function perspective(fov, aspect, near, far) {
  var f = 1 / Math.tan(fov / 2);
  var nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function sphereMesh(gl, latBands, lonBands) {
  var data = [];
  var index = [];
  var i, j, v, u, lat, lng, x, y, z;
  for (i = 0; i <= latBands; i++) {
    v = i / latBands;
    lat = (-90 + v * 180) * Math.PI / 180;
    for (j = 0; j <= lonBands; j++) {
      u = j / lonBands;
      lng = (-180 + u * 360) * Math.PI / 180;
      x = Math.cos(lat) * Math.sin(lng);
      y = Math.sin(lat);
      z = Math.cos(lat) * Math.cos(lng);
      data.push(x, y, z, u, v);
    }
  }
  var row = lonBands + 1;
  for (i = 0; i < latBands; i++) {
    for (j = 0; j < lonBands; j++) {
      var a = i * row + j;
      var b = a + row;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  var positions = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positions);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  var indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index), gl.STATIC_DRAW);
  return { positions: positions, indices: indices, count: index.length };
}

function program(gl, vs, fs) {
  var vert = shader(gl, gl.VERTEX_SHADER, vs);
  var frag = shader(gl, gl.FRAGMENT_SHADER, fs);
  var prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  return {
    program: prog,
    pos: gl.getAttribLocation(prog, "aPos"),
    uv: gl.getAttribLocation(prog, "aUv"),
    size: gl.getAttribLocation(prog, "aSize"),
    rot: gl.getUniformLocation(prog, "uRot"),
    proj: gl.getUniformLocation(prog, "uProj"),
    cam: gl.getUniformLocation(prog, "uCam"),
    map: gl.getUniformLocation(prog, "uMap"),
    dpr: gl.getUniformLocation(prog, "uDpr")
  };
}

function shader(gl, type, source) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  return sh;
}

var EARTH_VS = [
  "attribute vec3 aPos;",
  "attribute vec2 aUv;",
  "uniform mat3 uRot;",
  "uniform mat4 uProj;",
  "uniform float uCam;",
  "varying vec3 vN;",
  "varying vec2 vUv;",
  "void main() {",
  "  vec3 p = uRot * aPos;",
  "  vN = p;",
  "  vUv = aUv;",
  "  gl_Position = uProj * vec4(p.x, p.y, p.z - uCam, 1.0);",
  "}"
].join("\n");

var EARTH_FS = [
  "precision mediump float;",
  "varying vec3 vN;",
  "varying vec2 vUv;",
  "uniform sampler2D uMap;",
  "void main() {",
  "  vec3 n = normalize(vN);",
  "  vec3 color = texture2D(uMap, vUv).rgb;",
  "  vec3 light = normalize(vec3(-0.32, 0.42, 0.85));",
  "  float shade = 0.64 + 0.36 * max(dot(n, light), 0.0);",
  "  color *= shade;",
  "  vec3 viewDir = normalize(vec3(0.0, 0.0, 3.75) - n);",
  "  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);",
  "  color = mix(color, vec3(0.80, 0.58, 0.32), rim * 0.72);",
  "  gl_FragColor = vec4(color, 1.0);",
  "}"
].join("\n");

var GLOW_VS = [
  "attribute vec3 aPos;",
  "uniform mat3 uRot;",
  "uniform mat4 uProj;",
  "uniform float uCam;",
  "varying vec3 vN;",
  "void main() {",
  "  vec3 p = uRot * (aPos * 1.055);",
  "  vN = normalize(p);",
  "  gl_Position = uProj * vec4(p.x, p.y, p.z - uCam, 1.0);",
  "}"
].join("\n");

var GLOW_FS = [
  "precision mediump float;",
  "varying vec3 vN;",
  "void main() {",
  "  vec3 n = normalize(vN);",
  "  vec3 viewDir = normalize(vec3(0.0, 0.0, 3.75) - n);",
  "  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.1);",
  "  gl_FragColor = vec4(0.76, 0.54, 0.28, rim * 0.55);",
  "}"
].join("\n");

var DOT_VS = [
  "attribute vec3 aPos;",
  "attribute float aSize;",
  "uniform mat3 uRot;",
  "uniform mat4 uProj;",
  "uniform float uCam;",
  "uniform float uDpr;",
  "varying float vFront;",
  "void main() {",
  "  vec3 n = uRot * aPos;",
  "  vec3 p = n * 1.02;",
  "  vec4 view = vec4(p.x, p.y, p.z - uCam, 1.0);",
  "  gl_Position = uProj * view;",
  "  gl_PointSize = aSize * uDpr;",
  "  vFront = dot(n, normalize(vec3(0.0, 0.0, uCam) - p));",
  "}"
].join("\n");

var DOT_FS = [
  "precision mediump float;",
  "varying float vFront;",
  "void main() {",
  "  if (vFront < 0.08) discard;",
  "  if (length(gl_PointCoord - vec2(0.5)) > 0.46) discard;",
  "  gl_FragColor = vec4(0.90, 0.14, 0.11, 1.0);",
  "}"
].join("\n");

var canvas = document.getElementById("visitor-globe");
if (canvas) mount(canvas);
