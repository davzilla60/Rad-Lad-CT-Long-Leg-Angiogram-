/* 3-D CT room for the patient set-up step (three.js, procedural — no external models).
   window.SCG_ROOM3D(THREE, host) -> { play(onStep, onDone), reset(), start(), stop() }
   World axes: +x along the table toward the gantry, +y up, +z toward the camera.
   Patient supine, FEET FIRST (feet toward +x), arms raised above the head, IV in the right
   antecubital fossa (patient's right = +z, the camera side). */
window.SCG_ROOM3D = function(THREE, host){
  "use strict";
  var V3 = THREE.Vector3;

  /* ---------------- renderer / scene ---------------- */
  var renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9dedb);
  scene.fog = new THREE.Fog(0xd9dedb, 8, 16);

  /* image-based lighting from a simple bright clinical room */
  (function(){
    var env = new THREE.Scene();
    var room = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 12), new THREE.MeshBasicMaterial({ color:0x8c918e, side:THREE.BackSide }));
    room.position.y = 2.5; env.add(room);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color:0x6f736f }));
    floor.rotation.x = -Math.PI/2; floor.position.y = 0.01; env.add(floor);
    var pm = new THREE.MeshBasicMaterial({ color:new THREE.Color(5, 5, 4.8) });
    [[-2,-1.2],[0,-1.2],[2,-1.2],[-2,1.4],[0,1.4],[2,1.4]].forEach(function(p){
      var m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), pm);
      m.rotation.x = Math.PI/2; m.position.set(p[0], 4.95, p[1]); env.add(m);
    });
    var side = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.6), new THREE.MeshBasicMaterial({ color:new THREE.Color(1.6, 1.7, 1.75) }));
    side.position.set(0, 2.2, 5.9); side.rotation.y = Math.PI; env.add(side);
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.035).texture;
    pmrem.dispose();
  })();

  var camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

  var hemi = new THREE.HemisphereLight(0xffffff, 0x8f938f, 0.35);
  scene.add(hemi);
  var key = new THREE.DirectionalLight(0xfffaf2, 2.9);
  key.position.set(-1.2, 5.0, 2.6);
  key.target.position.set(0.2, 0.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  var sc = key.shadow.camera; sc.left = -3.2; sc.right = 3.2; sc.top = 2.6; sc.bottom = -2.6; sc.near = 1; sc.far = 12;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015; key.shadow.radius = 3.5;
  scene.add(key, key.target);
  var fill = new THREE.DirectionalLight(0xe8f0ff, 0.55);
  fill.position.set(3.5, 2.2, 3.5); scene.add(fill);

  /* ---------------- helpers ---------------- */
  function canvasTex(w, h, draw, repeat){
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if(repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function noise(g, w, h, n, a, col){
    for(var i=0;i<n;i++){ g.fillStyle = col.replace("A", (Math.random()*a).toFixed(3)); g.fillRect(Math.random()*w, Math.random()*h, 1+Math.random()*1.5, 1+Math.random()*1.5); }
  }
  function rrShape(w, h, r){
    var s = new THREE.Shape(), x = -w/2, y = -h/2;
    s.moveTo(x+r, y); s.lineTo(x+w-r, y); s.quadraticCurveTo(x+w, y, x+w, y+r);
    s.lineTo(x+w, y+h-r); s.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    s.lineTo(x+r, y+h); s.quadraticCurveTo(x, y+h, x, y+h-r);
    s.lineTo(x, y+r); s.quadraticCurveTo(x, y, x+r, y);
    return s;
  }
  /* rounded box: w along x, h along y, d along z */
  function rbox(w, h, d, r, mat, seg){
    r = Math.min(r, w/2-1e-3, h/2-1e-3, d/2-1e-3);
    var g = new THREE.ExtrudeGeometry(rrShape(w-2*r, h-2*r, Math.max(0.0008, r*0.6)),
      { depth:Math.max(0.0005, d-2*r), bevelEnabled:true, bevelThickness:r, bevelSize:r, bevelSegments:seg||4, curveSegments:6 });
    g.center();
    var m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function limb(a, b, r, mat){
    var dir = new V3().subVectors(b, a), len = dir.length();
    var m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 8, 20), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new V3(0,1,0), dir.normalize());
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function taper(a, b, r0, r1, mat){             // tapered limb segment with rounded ends
    var g = new THREE.Group(), dir = new V3().subVectors(b, a), len = dir.length();
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 28, 4), mat);
    cyl.position.copy(a).addScaledVector(dir, 0.5);
    cyl.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
    var ea = new THREE.Mesh(new THREE.SphereGeometry(r0, 24, 16), mat); ea.position.copy(a);
    var eb = new THREE.Mesh(new THREE.SphereGeometry(r1, 24, 16), mat); eb.position.copy(b);
    [cyl, ea, eb].forEach(function(m){ m.castShadow = m.receiveShadow = true; g.add(m); });
    return g;
  }
  function ellipsoid(rx, ry, rz, mat, seg){
    var m = new THREE.Mesh(new THREE.SphereGeometry(1, seg||40, (seg||40)*3/4|0), mat);
    m.scale.set(rx, ry, rz); m.castShadow = m.receiveShadow = true;
    return m;
  }
  function gridGeo(nu, nv, fn){
    var pos = [], uv = [], idx = [], i, j;
    for(i=0;i<=nu;i++) for(j=0;j<=nv;j++){ var p = fn(i/nu, j/nv); pos.push(p[0], p[1], p[2]); uv.push(i/nu, j/nv); }
    for(i=0;i<nu;i++) for(j=0;j<nv;j++){ var a = i*(nv+1)+j, b = a+nv+1; idx.push(a, b, a+1, b, b+1, a+1); }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function prof(pts, u){                   // smooth piecewise interpolation of [u, value] pairs
    if(u <= pts[0][0]) return pts[0][1];
    for(var i=1;i<pts.length;i++) if(u <= pts[i][0]){
      var t = (u-pts[i-1][0])/(pts[i][0]-pts[i-1][0]); t = t*t*(3-2*t);
      return pts[i-1][1] + (pts[i][1]-pts[i-1][1])*t;
    }
    return pts[pts.length-1][1];
  }

  /* ---------------- materials ---------------- */
  var M = {
    shell:  new THREE.MeshPhysicalMaterial({ color:0xf3f4f2, roughness:0.3, clearcoat:0.7, clearcoatRoughness:0.22 }),
    trim:   new THREE.MeshStandardMaterial({ color:0xb4bbc0, roughness:0.35, metalness:0.25 }),
    dark:   new THREE.MeshStandardMaterial({ color:0x3a3f44, roughness:0.55 }),
    bore:   new THREE.MeshStandardMaterial({ color:0xe9ebec, roughness:0.45, side:THREE.BackSide }),
    boreBand: new THREE.MeshStandardMaterial({ color:0xc7ccd0, roughness:0.5, side:THREE.BackSide }),
    pedestal: new THREE.MeshPhysicalMaterial({ color:0xe2dfd8, roughness:0.38, clearcoat:0.4 }),
    carbon: new THREE.MeshPhysicalMaterial({ color:0x24272b, roughness:0.32, clearcoat:0.8, clearcoatRoughness:0.15 }),
    mattress: new THREE.MeshStandardMaterial({ color:0x2f3d4a, roughness:0.62 }),
    foam:   new THREE.MeshStandardMaterial({ color:0xd9dcd6, roughness:0.85 }),
    skin:   new THREE.MeshPhysicalMaterial({ color:0xcf9a7c, roughness:0.58, sheen:0.4, sheenColor:new THREE.Color(0xffd6bf), sheenRoughness:0.6 }),
    hair:   new THREE.MeshStandardMaterial({ color:0x2a2018, roughness:0.88 }),
    brow:   new THREE.MeshStandardMaterial({ color:0x3b2c22, roughness:0.9 }),
    wall:   new THREE.MeshStandardMaterial({ color:0xe6e9e6, roughness:0.92 }),
    glass:  new THREE.MeshPhysicalMaterial({ color:0x1b2329, roughness:0.08, metalness:0.2, clearcoat:1 }),
    screen: new THREE.MeshBasicMaterial({ color:0xffffff }),
    tape:   new THREE.MeshStandardMaterial({ color:0xf5f5f0, roughness:0.6, transparent:true, opacity:0.85 }),
    tube:   new THREE.MeshPhysicalMaterial({ color:0xf2f5f7, roughness:0.15, transmission:0.6, thickness:0.002, transparent:true, opacity:0.9 }),
    syringe:new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.05, transmission:0.9, thickness:0.01, transparent:true, opacity:0.55 }),
    laser:  new THREE.MeshBasicMaterial({ color:new THREE.Color(1.0, 0.08, 0.05), toneMapped:false }),
    laserGlow: new THREE.MeshBasicMaterial({ color:new THREE.Color(1.0, 0.15, 0.1), toneMapped:false, transparent:true, opacity:0.25, depthWrite:false, blending:THREE.AdditiveBlending })
  };
  M.gown = new THREE.MeshStandardMaterial({ roughness:0.92, side:THREE.DoubleSide, map:canvasTex(256, 256, function(g, w, h){
    g.fillStyle = "#a9c8d8"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#7ea5bb";
    for(var y=8; y<h; y+=32) for(var x=8 + ((y/32)%2)*16; x<w; x+=32){
      g.beginPath(); g.moveTo(x, y-5); g.lineTo(x+5, y); g.lineTo(x, y+5); g.lineTo(x-5, y); g.closePath(); g.fill();
    }
    noise(g, w, h, 5000, 0.08, "rgba(40,60,80,A)");
  }, [5, 3]) });
  M.blanket = new THREE.MeshStandardMaterial({ roughness:0.97, side:THREE.DoubleSide, map:canvasTex(1024, 512, function(g, w, h){
    g.fillStyle = "#c9d7e1"; g.fillRect(0, 0, w, h);
    for(var y=0; y<h; y+=8) for(var x=(y/8%2)*4; x<w; x+=8){          // cellular weave
      g.fillStyle = "rgba(150,170,185,.45)"; g.beginPath(); g.arc(x+2, y+2, 1.6, 0, 7); g.fill();
    }
    g.fillStyle = "rgba(255,255,255,.18)"; for(var i=0;i<w;i+=4) g.fillRect(i, 0, 1, h);
    g.fillStyle = "#e9eef1"; g.fillRect(0, 0, w*0.03, h);                // hem band at the waist
    noise(g, w, h, 16000, 0.07, "rgba(60,70,80,A)");
  }) });
  M.floor = new THREE.MeshStandardMaterial({ roughness:0.5, map:canvasTex(512, 512, function(g, w, h){
    g.fillStyle = "#cfd4d1"; g.fillRect(0, 0, w, h);
    noise(g, w, h, 26000, 0.12, "rgba(70,80,75,A)");
    g.strokeStyle = "rgba(120,130,125,.35)"; g.lineWidth = 2;
    for(var i=0;i<=4;i++){ g.beginPath(); g.moveTo(i*w/4, 0); g.lineTo(i*w/4, h); g.stroke(); g.beginPath(); g.moveTo(0, i*h/4); g.lineTo(w, i*h/4); g.stroke(); }
  }, [5, 5]) });

  /* ---------------- room ---------------- */
  var floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), M.floor);
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  var wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.5), M.wall);
  wall.position.set(0, 2.25, -2.4); wall.receiveShadow = true; scene.add(wall);
  var skirting = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 0.02), M.dark);
  skirting.position.set(0, 0.05, -2.39); scene.add(skirting);
  // control-room window
  var winFrame = rbox(1.7, 0.85, 0.08, 0.02, M.trim); winFrame.position.set(-1.2, 1.75, -2.36); scene.add(winFrame);
  var winGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.73), new THREE.MeshPhysicalMaterial({ roughness:0.06, clearcoat:1, map:canvasTex(512, 236, function(g, w, h){
    var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#56656f"); gr.addColorStop(1, "#2b343a"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1a2025"; g.fillRect(0, h*0.72, w, h*0.28);           // desk
    [[60, 150], [180, 150], [300, 150], [400, 150]].forEach(function(p, i){
      g.fillStyle = "#0e1215"; g.fillRect(p[0], p[1]-74, 96, 66);
      g.fillStyle = i === 1 ? "#3d6a8a" : "#2f4d63"; g.fillRect(p[0]+5, p[1]-70, 86, 56);
      g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(p[0]+12, p[1]-60, 40, 3); g.fillRect(p[0]+12, p[1]-52, 60, 3);
      g.fillStyle = "#0e1215"; g.fillRect(p[0]+44, p[1]-8, 8, 12);
    });
    g.fillStyle = "rgba(255,255,255,.07)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(w*0.35, 0); g.lineTo(w*0.15, h); g.lineTo(0, h); g.fill();
  }) })); winGlass.position.set(-1.2, 1.75, -2.31); scene.add(winGlass);
  // radiation warning sign
  var sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), new THREE.MeshBasicMaterial({ map:canvasTex(256, 82, function(g, w, h){
    g.fillStyle = "#1c1f22"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ff3b30"; g.font = "bold 34px Segoe UI, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("X-RAY ON", w/2, h/2+2);
  }), toneMapped:false }));
  sign.position.set(1.85, 2.45, -2.38); scene.add(sign);

  /* ---------------- gantry ---------------- */
  var G = 1.62, BY = 1.08, BR = 0.40, GD = 0.84, HC = 1.12;   // centre x, bore centre y, bore radius, depth, housing centre y
  var gantry = new THREE.Group(); scene.add(gantry);
  (function(){
    var shape = rrShape(2.05, 1.98, 0.5);
    var hole = new THREE.Path(); hole.absarc(0, BY-HC, BR+0.05, 0, Math.PI*2, true); shape.holes.push(hole);
    var g = new THREE.ExtrudeGeometry(shape, { depth:GD-0.14, bevelEnabled:true, bevelThickness:0.07, bevelSize:0.06, bevelSegments:10, curveSegments:128 });
    g.center(); g.rotateY(Math.PI/2);
    var shell = new THREE.Mesh(g, M.shell); shell.castShadow = shell.receiveShadow = true;
    shell.position.set(G, HC, 0); gantry.add(shell);
    var liner = new THREE.Mesh(new THREE.CylinderGeometry(BR+0.002, BR+0.002, GD-0.02, 128, 1, true), M.bore);
    liner.rotation.z = Math.PI/2; liner.position.set(G, BY, 0); liner.receiveShadow = true; gantry.add(liner);
    var band = new THREE.Mesh(new THREE.CylinderGeometry(BR, BR, 0.14, 128, 1, true), M.boreBand);
    band.rotation.z = Math.PI/2; band.position.set(G, BY, 0); gantry.add(band);
    [-1, 1].forEach(function(s){
      var ring = new THREE.Mesh(new THREE.TorusGeometry(BR+0.035, 0.016, 20, 160), M.trim);
      ring.rotation.y = Math.PI/2; ring.position.set(G + s*(GD/2+0.005), BY, 0); gantry.add(ring);
    });
    var plinth = rbox(GD+0.02, 0.1, 1.5, 0.04, M.pedestal); plinth.position.set(G, 0.05, 0); gantry.add(plinth);
    // front-face control panels + display
    [0.66, -0.66].forEach(function(z, i){
      var p = rbox(0.03, 0.16, 0.24, 0.012, M.dark); p.position.set(G-GD/2-0.07, BY+0.06, z); gantry.add(p);
      if(i === 0){
        var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshBasicMaterial({ toneMapped:false, map:canvasTex(200, 120, function(g, w, h){
          g.fillStyle = "#06120c"; g.fillRect(0, 0, w, h);
          g.fillStyle = "#5fe08a"; g.font = "bold 22px Segoe UI, Arial"; g.fillText("READY", 12, 34);
          g.font = "16px Segoe UI, Arial"; g.fillStyle = "#9fe7b8"; g.fillText("Table  000.0", 12, 66); g.fillText("Height 088.0", 12, 92);
        }) }));
        scr.rotation.y = -Math.PI/2; scr.position.set(G-GD/2-0.087, BY+0.06, z); gantry.add(scr);
      }
    });
    // laser aperture
    var ap = rbox(0.02, 0.025, 0.12, 0.008, M.dark); ap.position.set(G-GD/2-0.065, BY+BR+0.12, 0); gantry.add(ap);
  })();
  var LASER_X = G - GD/2 - 0.085;

  /* ---------------- couch (fixed base + moving table) ---------------- */
  var T = 0.90;                          // top of the mattress
  var base = rbox(1.35, 0.07, 0.66, 0.03, M.dark); base.position.set(-0.55, 0.035, 0); scene.add(base);
  var ped = rbox(0.95, 0.62, 0.44, 0.08, M.pedestal); ped.position.set(-0.55, 0.38, 0); scene.add(ped);
  var cradleRail = rbox(1.7, 0.09, 0.36, 0.035, M.pedestal); cradleRail.position.set(-0.35, 0.74, 0); scene.add(cradleRail);

  var couch = new THREE.Group(); scene.add(couch);
  var top = rbox(2.4, 0.05, 0.5, 0.02, M.carbon); top.position.set(0, 0.81, 0); couch.add(top);
  var mat = rbox(2.05, 0.055, 0.48, 0.022, M.mattress); mat.position.set(-0.1, 0.8625, 0); couch.add(mat);

  /* ---------------- patient (local to couch) ---------------- */
  var hx = -0.86;                        // head centre (local x)
  var patient = new THREE.Group(); couch.add(patient);
  var pillow = rbox(0.3, 0.05, 0.32, 0.022, M.foam); pillow.position.set(hx+0.01, T+0.024, 0); patient.add(pillow);
  var armBoard = rbox(0.24, 0.035, 0.52, 0.015, M.foam); armBoard.position.set(hx-0.24, T+0.018, 0); patient.add(armBoard);

  var hy = T + 0.048 + 0.092;            // head centre height
  /* sculpted head: displaced sphere. Canonical frame: +Y = crown, +Z = face, +X = patient's left.
     Basis maps it to supine on the table: crown -> -x (toward the arm board), face -> +y. */
  function g2(x, y, sx, sy){ return Math.exp(-(x*x)/(sx*sx) - (y*y)/(sy*sy)); }
  function sstep(e0, e1, x){ var t = Math.max(0, Math.min(1, (x - e0)/(e1 - e0))); return t*t*(3 - 2*t); }
  function headShape(p){                          // p on the unit sphere -> displaced point
    var x = p.x, y = p.y, z = p.z, f = Math.max(0, z), d = 0;
    d += 0.055*f*g2(x, y - 0.3, 0.55, 0.1);                                    // brow ridge
    d -= 0.07*f*(g2(x - 0.32, y - 0.1, 0.15, 0.09) + g2(x + 0.32, y - 0.1, 0.15, 0.09));  // eye sockets
    d += 0.11*f*g2(x, y + 0.06, 0.065, 0.2);                                   // nasal bridge
    d += 0.13*f*g2(x, y + 0.27, 0.085, 0.07);                                  // nose tip
    d += 0.045*f*(g2(x - 0.11, y + 0.3, 0.06, 0.05) + g2(x + 0.11, y + 0.3, 0.06, 0.05)); // alae
    d += 0.035*f*(g2(x - 0.45, y + 0.1, 0.18, 0.14) + g2(x + 0.45, y + 0.1, 0.18, 0.14)); // cheekbones
    d += 0.03*f*g2(x, y + 0.47, 0.2, 0.045) - 0.02*f*g2(x, y + 0.53, 0.2, 0.018) + 0.022*f*g2(x, y + 0.58, 0.17, 0.04); // lips
    d += 0.06*f*g2(x, y + 0.82, 0.24, 0.1);                                    // chin
    d += 0.05*Math.max(0, -z)*g2(x, y - 0.1, 0.7, 0.5);                       // occiput
    var q = new V3(x, y, z).multiplyScalar(1 + d);
    if(y < -0.2){ var t = Math.min(1, (-y - 0.2)/0.8); q.x *= 1 - 0.2*t; q.z += 0.1*t*Math.max(0, z); }   // jaw taper
    if(y > 0.2 && z > 0) q.z *= 1 - 0.07*(y - 0.2);                            // sloping forehead
    return q;
  }
  /* one mesh, painted with vertex colours: skin, hair (with a soft hairline), brows, lash lines, lips */
  function headGeo(){
    var g = new THREE.SphereGeometry(1, 128, 96), p = g.attributes.position, v = new V3(), col = [];
    var skin = new THREE.Color(0xcf9a7c), hairC = new THREE.Color(0x1e1610), browC = new THREE.Color(0x3a2a20),
        lipC = new THREE.Color(0xb46e62), c = new THREE.Color();
    for(var i=0;i<p.count;i++){
      v.fromBufferAttribute(p, i).normalize();
      var x = v.x, y = v.y, z = v.z, f = Math.max(0, z);
      var line = -0.55*y + 0.835*z;                                          // hairline plane (tilted)
      var w = sstep(0.24, 0.17, line);                                       // 1 = hair
      w *= 1 - sstep(-0.35, -0.6, y)*sstep(-0.2, 0.2, z);                     // keep the jaw/neck front clear
      var q = headShape(v);
      var lift = 1 + 0.028*w;
      p.setXYZ(i, q.x*0.074*lift, q.y*0.108*lift, q.z*0.094*lift);
      c.copy(skin);
      c.lerp(lipC, 0.65*f*g2(x, y + 0.53, 0.2, 0.06));
      c.lerp(browC, 0.85*f*(g2(x - 0.3, y - 0.25, 0.17, 0.035) + g2(x + 0.3, y - 0.25, 0.17, 0.035)));
      c.lerp(browC, 0.6*f*(g2(x - 0.32, y - 0.07, 0.11, 0.012) + g2(x + 0.32, y - 0.07, 0.11, 0.012)));  // closed lids
      c.lerp(hairC, w);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  var headG = new THREE.Group();
  headG.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3(0, 0, -1), new V3(-1, 0, 0), new V3(0, 1, 0)));
  headG.position.set(hx, hy, 0); patient.add(headG);
  M.head = M.skin.clone(); M.head.color.set(0xffffff); M.head.vertexColors = true;
  var head = new THREE.Mesh(headGeo(), M.head); head.castShadow = head.receiveShadow = true; headG.add(head);
  var hair = head;
  [-1, 1].forEach(function(sd){
    var ear = ellipsoid(0.009, 0.024, 0.014, M.skin, 24); ear.position.set(sd*0.072, -0.02, -0.012); ear.rotation.x = -0.15; headG.add(ear);
  });
  var neck = limb(new V3(hx+0.07, T+0.098, 0), new V3(hx+0.2, T+0.1, 0), 0.05, M.skin); patient.add(neck);
  var jaw = head, nose = head;                    // (kept for the laser hit-list below)

  // torso in a gown: lofted elliptical sections, flattened against the mattress
  var tx0 = hx + 0.15, tLen = 0.66;
  var RZ = [[0, 0.2], [0.12, 0.205], [0.4, 0.175], [0.7, 0.155], [1, 0.18]];
  var RY = [[0, 0.085], [0.12, 0.1], [0.4, 0.118], [0.7, 0.1], [1, 0.105]];
  var torso = new THREE.Mesh(gridGeo(60, 48, function(u, v){
    var cap = u < 0.09 ? Math.pow(Math.sin(u/0.09*Math.PI/2), 0.42) : 1;
    var rz = prof(RZ, u)*cap, ry = prof(RY, u)*cap, a = -Math.PI/2 + v*Math.PI*2, s = Math.sin(a);
    var y = T + ry*0.55 + (s >= 0 ? ry*s : ry*0.55*s);
    var fold = 0.003*Math.sin(u*40 + v*18) + 0.002*Math.sin(u*90 - v*30);
    return [tx0 + u*tLen, y + (s > 0 ? fold : 0), rz*Math.cos(a)*(1 + (s > 0 ? fold*2 : 0))];
  }), M.gown);
  torso.castShadow = torso.receiveShadow = true; patient.add(torso);
  var vneck = neck;

  // arms raised above the head, resting on the arm board
  var arms = {};
  [1, -1].forEach(function(s){                 // +1 = patient's right (camera side)
    var sh = new V3(hx+0.2, T+0.12, s*0.19);
    var el = new V3(hx-0.03, T+0.1, s*0.2);
    var wr = new V3(hx-0.25, T+0.072, s*0.05);
    patient.add(taper(sh, el, 0.047, 0.036, M.skin));
    patient.add(taper(sh, sh.clone().lerp(el, 0.4), 0.056, 0.05, M.gown));     // short sleeve
    patient.add(taper(el, wr, 0.037, 0.025, M.skin));
    var j = ellipsoid(0.036, 0.034, 0.036, M.skin, 24); j.position.copy(el); patient.add(j);
    var dir = new V3().subVectors(wr, el).normalize();
    var hand = new THREE.Group(); hand.position.copy(wr); hand.position.y -= 0.004;
    hand.quaternion.setFromUnitVectors(new V3(1, 0, 0), dir); patient.add(hand);
    var palm = ellipsoid(0.05, 0.016, 0.037, M.skin, 28); palm.position.x = 0.05; hand.add(palm);
    var fing = ellipsoid(0.045, 0.012, 0.034, M.skin, 28); fing.position.set(0.105, -0.006, 0); fing.rotation.z = -0.35; hand.add(fing);
    var thumb = taper(new V3(0.02, 0.0, s*0.03), new V3(0.075, -0.004, s*0.05), 0.011, 0.008, M.skin); hand.add(thumb);
    arms[s] = { sh:sh, el:el, wr:wr };
  });
  // IV cannula + clear dressing in the right antecubital fossa
  var cannulaLocal = new V3(hx-0.005, T+0.143, 0.192);
  var dressing = rbox(0.045, 0.004, 0.035, 0.0018, M.tape); dressing.position.copy(cannulaLocal); dressing.position.y -= 0.004; patient.add(dressing);
  var hub = limb(cannulaLocal.clone().add(new V3(0.0, 0.002, 0)), cannulaLocal.clone().add(new V3(-0.03, 0.006, 0.004)), 0.004, new THREE.MeshStandardMaterial({ color:0xf0a830, roughness:0.4 }));
  patient.add(hub);

  // blanket draped over hips and legs, feet toward the gantry.
  // Cloth model: two soft leg mounds (gaussian), soft-maxed so the fabric bridges between them,
  // tails falling gently to the mattress, then hanging over the mattress edge.
  var bx0 = hx + 0.64, bLen = 1.1;
  var LC = [[0, 0.07], [0.2, 0.095], [0.5, 0.095], [0.8, 0.09], [1, 0.095]];          // leg centre |z|
  var LR = [[0, 0.15], [0.18, 0.11], [0.45, 0.075], [0.55, 0.07], [0.8, 0.06], [0.9, 0.06], [1, 0.07]];   // leg spread
  var LH = [[0, 0.165], [0.15, 0.165], [0.4, 0.145], [0.52, 0.135], [0.56, 0.14], [0.75, 0.115],
            [0.86, 0.095], [0.91, 0.15], [0.95, 0.185], [0.98, 0.15], [1, 0.09]];        // leg top height
  function clothY(u, z){
    var c = prof(LC, u), r = prof(LR, u), h = prof(LH, u);
    var gl = Math.exp(-Math.pow((z + c)/r, 2)), gr = Math.exp(-Math.pow((z - c)/r, 2));
    var k = 9, sm = Math.log(Math.exp(k*gl) + Math.exp(k*gr))/k;          // soft max
    sm = Math.min(1, sm*1.03);
    var tail = 0.018*Math.exp(-Math.pow(z/0.32, 2));                       // cloth never lies quite flat
    var hang = Math.max(0, Math.abs(z) - 0.245);
    return T + 0.006 + h*sm + tail - hang*1.6 - hang*hang*6;
  }
  var blanket = new THREE.Mesh(gridGeo(140, 72, function(u, v){
    var sgn = v*2 - 1, z = sgn*0.33;
    var y = clothY(u, z);
    var wr = (0.0035*Math.sin(19*u + 11*sgn) + 0.0025*Math.sin(53*u - 17*sgn + 1.3) + 0.0015*Math.sin(130*u + 5*sgn)) *
             (0.5 + 0.5*Math.exp(-Math.pow(z/0.2, 2)));
    // diagonal drape folds on the sides
    wr += Math.abs(z) > 0.17 ? 0.006*Math.sin(28*u + 40*Math.abs(z)) * Math.min(1, (Math.abs(z) - 0.17)/0.06) : 0;
    var x = bx0 + u*bLen;
    if(u > 0.975){ var e = (u - 0.975)/0.025; x += e*0.03; y -= e*e*0.07; }   // end falls over the feet
    return [x, y + wr, z];
  }), M.blanket);
  blanket.castShadow = blanket.receiveShadow = true; patient.add(blanket);
  // folded-down top hem
  (function(){
    var pts = [];
    for(var i=0;i<=48;i++){ var z = (i/48*2 - 1)*0.33; pts.push(new V3(bx0 + 0.012, clothY(0.01, z) + 0.016, z)); }
    var cuff = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.018, 12, false), M.blanket);
    cuff.scale.set(1.6, 1, 1); cuff.position.x = -bx0*0.6;
    cuff.castShadow = true; patient.add(cuff);
  })();

  /* ---------------- pump injector (fixed, head end) ---------------- */
  var inj = new THREE.Group(); scene.add(inj);
  inj.position.set(-1.5, 0, 0.55);
  var legs = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 5), M.dark); legs.position.y = 0.06; legs.castShadow = true; inj.add(legs);
  for(var k=0;k<5;k++){ var w = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), M.dark); var ang = k/5*Math.PI*2; w.position.set(Math.cos(ang)*0.26, 0.03, Math.sin(ang)*0.26); inj.add(w); }
  var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.15, 20), M.trim); pole.position.y = 0.65; pole.castShadow = true; inj.add(pole);
  var headU = rbox(0.26, 0.17, 0.34, 0.04, M.shell); headU.position.set(0.06, 1.3, 0); headU.rotation.z = -0.5; inj.add(headU);
  var injScr = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), new THREE.MeshBasicMaterial({ toneMapped:false, map:canvasTex(140, 90, function(g, w, h){
    g.fillStyle = "#081018"; g.fillRect(0, 0, w, h); g.fillStyle = "#8fd3ff"; g.font = "bold 15px Segoe UI, Arial";
    g.fillText("A 60 mL", 8, 24); g.fillText("B 40 mL", 8, 46); g.fillStyle = "#5fe08a"; g.fillText("5.0 mL/s", 8, 72);
  }) }));
  injScr.position.set(0.06, 1.33, 0.172); injScr.rotation.z = -0.5; inj.add(injScr);
  var tips = [];
  [-0.07, 0.07].forEach(function(z, i){
    var sy = new THREE.Group(); sy.position.set(0.17, 1.23, z); sy.rotation.z = -0.5 - Math.PI/2*0.55; inj.add(sy);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.2, 24), M.syringe); barrel.position.y = -0.1; sy.add(barrel);
    var fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 24), new THREE.MeshStandardMaterial({ color:i ? 0xdfeef8 : 0xf3e7b8, roughness:0.2, transparent:true, opacity:0.7 }));
    fluid.position.y = -0.11; sy.add(fluid);
    var tip = new THREE.Object3D(); tip.position.y = -0.22; sy.add(tip); tips.push(tip);
  });

  /* IV extension line: rebuilt as the couch moves */
  var tubeMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.tube); tubeMesh.castShadow = true; scene.add(tubeMesh);
  function updateTube(){
    scene.updateMatrixWorld(true);
    var a = tips[0].getWorldPosition(new V3()), b = patient.localToWorld(cannulaLocal.clone().add(new V3(-0.03, 0.006, 0.004)));
    var mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - 0.1; mid.z += 0.1;
    var c = new THREE.CatmullRomCurve3([a, a.clone().add(new V3(0.03, -0.12, 0.02)), mid, b.clone().add(new V3(-0.12, 0.05, 0.05)), b]);
    tubeMesh.geometry.dispose();
    tubeMesh.geometry = new THREE.TubeGeometry(c, 90, 0.0032, 8, false);
  }

  /* ---------------- lasers (traced onto the patient's surface) ---------------- */
  var laserGroup = new THREE.Group(); laserGroup.visible = false; scene.add(laserGroup);
  var hitTargets = [];
  patient.traverse(function(c){ if(c.isMesh && c !== pillow && c !== armBoard) hitTargets.push(c); });
  var ray = new THREE.Raycaster();
  function laserLine(points){
    if(points.length < 2) return;
    var c = new THREE.CatmullRomCurve3(points);
    laserGroup.add(new THREE.Mesh(new THREE.TubeGeometry(c, points.length*2, 0.0016, 6, false), M.laser));
    laserGroup.add(new THREE.Mesh(new THREE.TubeGeometry(c, points.length*2, 0.006, 6, false), M.laserGlow));
  }
  function buildLasers(){
    while(laserGroup.children.length){ var m = laserGroup.children.pop(); m.geometry.dispose(); }
    scene.updateMatrixWorld(true);
    var pts = [], z, hit;
    for(z=-0.36; z<=0.36; z+=0.008){                       // transverse line in the gantry laser plane
      ray.set(new V3(LASER_X, 2, z), new V3(0, -1, 0));
      hit = ray.intersectObjects(hitTargets.concat([mat]), false)[0];
      if(hit) pts.push(hit.point.clone().addScaledVector(hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new V3(0,1,0), 0.002));
    }
    laserLine(pts);
    pts = [];
    for(var x=LASER_X-0.3; x<=LASER_X+0.32; x+=0.01){       // longitudinal line at mid-axillary height
      ray.set(new V3(x, T+0.11, 1.0), new V3(0, 0, -1));
      hit = ray.intersectObjects(hitTargets, false)[0];
      if(hit) pts.push(hit.point.clone().add(new V3(0, 0, 0.002)));
    }
    laserLine(pts);
    // the beam from the gantry aperture down to the patient
    var beam = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.5), M.laserGlow);
    beam.position.set(LASER_X, BY+BR+0.02, 0); beam.rotation.y = Math.PI/2; laserGroup.add(beam);
  }

  /* ---------------- camera / animation ---------------- */
  var COUCH0 = 0.0;
  var landmarkLocal = hx + 0.38;                              // xiphisternum
  var chestLocal = hx + 0.52;                                 // upper abdomen → isocentre (start of the run-off)
  var X1 = LASER_X - landmarkLocal, X2 = G - chestLocal;
  var CAM_A = { p:new V3(-0.95, 2.55, 3.65), t:new V3(-0.2, 0.88, 0) };
  var CAM_B = { p:new V3(-0.55, 2.4, 3.75), t:new V3(0.75, 0.92, 0) };
  function setCam(k){
    camera.position.lerpVectors(CAM_A.p, CAM_B.p, k);
    camera.lookAt(new V3().lerpVectors(CAM_A.t, CAM_B.t, k));
  }
  function ease(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }

  var running = false, raf = 0, anim = null;
  function resize(){
    var w = host.clientWidth || 600, h = host.clientHeight || 600;
    renderer.setSize(w, h, false); camera.aspect = w/h;
    camera.fov = w/h < 0.9 ? 42 : 30;              // narrow phone viewports: widen the view
    camera.updateProjectionMatrix();
  }
  function frame(now){
    raf = 0;
    if(anim){
      var t = (now - anim.t0)/1000, step = anim.step;
      if(t < 2.6){ couch.position.x = COUCH0 + (X1 - COUCH0)*ease(t/2.6); if(step < 1){ anim.step = 1; anim.onStep(1); } }
      else if(t < 4.1){ couch.position.x = X1; if(step < 2){ anim.step = 2; buildLasers(); laserGroup.visible = true; anim.onStep(2); } }
      else if(t < 6.6){ if(step < 3){ anim.step = 3; laserGroup.visible = false; anim.onStep(3); } couch.position.x = X1 + (X2 - X1)*ease((t - 4.1)/2.5); }
      else { couch.position.x = X2; var done = anim.onDone; anim = null; if(done) done(); }
      setCam(Math.min(1, t/6.6));
      updateTube();
    }
    renderer.render(scene, camera);
    if(running && anim) raf = requestAnimationFrame(frame);
  }
  function kick(){ if(!raf) raf = requestAnimationFrame(frame); }

  var ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(function(){ resize(); kick(); }) : null;
  if(ro) ro.observe(host);
  resize();

  function reset(){
    anim = null; couch.position.x = COUCH0; laserGroup.visible = false; setCam(0); updateTube(); kick();
  }
  reset();

  return {
    play:function(onStep, onDone){ running = true; anim = { t0:performance.now(), step:0, onStep:onStep || function(){}, onDone:onDone }; kick(); },
    reset:reset,
    start:function(){ running = true; resize(); kick(); },
    stop:function(){ running = false; if(raf){ cancelAnimationFrame(raf); raf = 0; } },
    pose:function(k){ anim = null; couch.position.x = k===2 ? X1 : (k===3 ? X2 : COUCH0); if(k===2){ buildLasers(); laserGroup.visible = true; } else laserGroup.visible = false; setCam(k===2 ? 0.55 : k===3 ? 1 : 0); updateTube(); kick(); },
    cam:function(p, t){ CAM_A = CAM_B = { p:new V3(p[0],p[1],p[2]), t:new V3(t[0],t[1],t[2]) }; setCam(0); kick(); },
    finish:function(){ if(anim){ anim.t0 = performance.now() - 6600; kick(); } },
    renderer:renderer
  };
};
