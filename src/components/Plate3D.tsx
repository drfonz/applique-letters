import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vec2 } from "@/lib/geometry";
import { handleMesh, type HandlePlacement, type HandleSettings } from "@/lib/handle";
import { extrudeRegions, type Mesh } from "@/lib/mesh";
import type { PlacedLetter, PlateLayout } from "@/lib/plates";
import { cn } from "@/lib/utils";

const COLOURS = [0xe87a93, 0xe8b46a, 0x7fc59a, 0x78a6e0, 0xb48be0];
const HANDLE_COLOUR = 0xf4efe8;
const HANDLE_ACTIVE = 0xffffff;

interface Plate3DProps {
  plate: PlateLayout;
  bed: { width: number; depth: number };
  thickness: number;
  handle: HandleSettings;
  /** Each letter's grip handle in bed coordinates. */
  handleOf: (letter: PlacedLetter) => HandlePlacement | null;
  /** Makes handles draggable; called with the bed point the handle is dragged to. */
  onHandleMove?: (letter: PlacedLetter, point: Vec2) => void;
  className?: string;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

function toGeometry(mesh: Mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Interactive 3D view of a build plate (drag to orbit, scroll to zoom, drag a handle to move it). */
export function Plate3D({ plate, bed, thickness, handle, handleOf, onHandleMove, className }: Plate3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const handleMeshes = useRef<THREE.Mesh[]>([]);
  const moveRef = useRef(onHandleMove);
  moveRef.current = onHandleMove;
  const plateRef = useRef(plate);
  plateRef.current = plate;
  /** Letter whose handle is being dragged, kept across rebuilds so it stays highlighted. */
  const activeRef = useRef<number | null>(null);

  // Renderer, camera and bed: rebuilt only when the bed changes, so the view stays put.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Slicer convention: Z up, origin at the front-left corner of the bed.
    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 5000);
    camera.up.set(0, 0, 1);
    const size = Math.max(bed.width, bed.depth);
    camera.position.set(bed.width / 2, -size * 0.75, size * 1.05);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(bed.width / 2, bed.depth / 2, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(bed.width * 0.2, -bed.depth * 0.4, size * 1.5);
    scene.add(sun);

    const bedGeo = new THREE.BoxGeometry(bed.width, bed.depth, 2);
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.85, metalness: 0.1 });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.position.set(bed.width / 2, bed.depth / 2, -1);
    scene.add(bedMesh);

    const grid = new THREE.GridHelper(size, Math.round(size / 32), 0x555a66, 0x4a4e58);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(bed.width / 2, bed.depth / 2, 0.05);
    scene.add(grid);

    stageRef.current = { renderer, scene, camera, controls };

    // Handle dragging: pick a handle, then follow the pointer across the template's top face.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let dragging: number | null = null;
    let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const aim = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };
    const pickHandle = (e: PointerEvent) => {
      if (!moveRef.current) return null;
      aim(e);
      const hit = raycaster.intersectObjects(handleMeshes.current, false)[0];
      return hit ? (hit.object.userData.letter as number) : null;
    };
    const setActive = (index: number | null) => {
      activeRef.current = index;
      for (const m of handleMeshes.current) {
        (m.material as THREE.MeshStandardMaterial).color.setHex(
          m.userData.letter === index ? HANDLE_ACTIVE : HANDLE_COLOUR,
        );
        (m.material as THREE.MeshStandardMaterial).emissive.setHex(m.userData.letter === index ? 0x442222 : 0);
      }
    };
    const onDown = (e: PointerEvent) => {
      const index = pickHandle(e);
      if (index === null) return;
      dragging = index;
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(handleMeshes.current[0]?.userData.top ?? 0));
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      setActive(index);
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (dragging === null) {
        renderer.domElement.style.cursor = pickHandle(e) !== null ? "grab" : "";
        return;
      }
      aim(e);
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, p)) return;
      const letter = plateRef.current.letters[dragging];
      if (letter) moveRef.current?.(letter, [p.x, p.y]);
    };
    const onUp = () => {
      if (dragging === null) return;
      dragging = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = "";
      setActive(null);
    };
    // Capture phase, so a handle drag starts before OrbitControls sees the pointer.
    renderer.domElement.addEventListener("pointerdown", onDown, { capture: true });
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);

    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown, { capture: true });
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      controls.dispose();
      bedGeo.dispose();
      bedMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      stageRef.current = null;
    };
  }, [bed.width, bed.depth]);

  // Letters and handles: rebuilt whenever the plate or a handle changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const handles: THREE.Mesh[] = [];
    plate.letters.forEach((letter, i) => {
      const geo = toGeometry(extrudeRegions(letter.regions, thickness));
      const mat = new THREE.MeshStandardMaterial({
        color: COLOURS[i % COLOURS.length],
        roughness: 0.5,
        flatShading: true,
      });
      group.add(new THREE.Mesh(geo, mat));
      disposables.push(geo, mat);
      const h = handleOf(letter);
      if (h) {
        const hGeo = toGeometry(handleMesh(h, thickness, handle.height));
        const active = activeRef.current === i;
        const hMat = new THREE.MeshStandardMaterial({
          color: active ? HANDLE_ACTIVE : HANDLE_COLOUR,
          emissive: active ? 0x442222 : 0,
          roughness: 0.4,
        });
        const mesh = new THREE.Mesh(hGeo, hMat);
        mesh.userData = { letter: i, top: thickness };
        group.add(mesh);
        handles.push(mesh);
        disposables.push(hGeo, hMat);
      }
    });
    stage.scene.add(group);
    handleMeshes.current = handles;
    return () => {
      stage.scene.remove(group);
      disposables.forEach((d) => d.dispose());
    };
  }, [plate, thickness, handle.height, handleOf, bed.width, bed.depth]);

  return (
    <div
      ref={mountRef}
      className={cn("h-[420px] w-full overflow-hidden rounded-xl bg-muted/60 sm:h-[520px]", className)}
    />
  );
}
