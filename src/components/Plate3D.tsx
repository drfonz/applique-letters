import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlateLayout } from "@/lib/plates";
import { templateSolid, type HandleSettings } from "@/lib/handle";
import { cn } from "@/lib/utils";

const COLOURS = [0xe87a93, 0xe8b46a, 0x7fc59a, 0x78a6e0, 0xb48be0];

interface Plate3DProps {
  plate: PlateLayout;
  bed: { width: number; depth: number };
  thickness: number;
  handle: HandleSettings;
  className?: string;
}

/** Interactive 3D view of a build plate (drag to orbit, scroll to zoom). */
export function Plate3D({ plate, bed, thickness, handle, className }: Plate3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

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

    const disposables: { dispose(): void }[] = [];

    const bedGeo = new THREE.BoxGeometry(bed.width, bed.depth, 2);
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.85, metalness: 0.1 });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.position.set(bed.width / 2, bed.depth / 2, -1);
    scene.add(bedMesh);
    disposables.push(bedGeo, bedMat);

    const grid = new THREE.GridHelper(size, Math.round(size / 32), 0x555a66, 0x4a4e58);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(bed.width / 2, bed.depth / 2, 0.05);
    scene.add(grid);

    plate.letters.forEach((letter, i) => {
      const mesh = templateSolid(letter.regions, thickness, handle);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: COLOURS[i % COLOURS.length],
        roughness: 0.5,
        flatShading: true,
      });
      scene.add(new THREE.Mesh(geo, mat));
      disposables.push(geo, mat);
    });

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
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [plate, bed.width, bed.depth, thickness, handle]);

  return (
    <div
      ref={mountRef}
      className={cn("h-[420px] w-full overflow-hidden rounded-xl bg-muted/60 sm:h-[520px]", className)}
    />
  );
}
