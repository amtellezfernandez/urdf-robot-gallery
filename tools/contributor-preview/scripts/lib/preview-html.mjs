import { TO_MESH_REFERENCE_KEY_SOURCE } from "./mesh-reference-key.mjs";

export const buildPreviewHtml = ({ robot, config, moduleUrls }) => {
  const payload = {
    urdfUrl: robot.urdfUrl,
    urdfPath: robot.urdfPath || "",
    assetBaseUrl: robot.assetBaseUrl || "",
    packages: robot.packages || {},
    meshIndex: robot.meshIndex || {},
    meshFileIndex: robot.meshFileIndex || {},
    meshReferenceIndex: robot.meshReferenceIndex || {},
    background: config.background,
    width: config.width,
    height: config.height,
    showGround: config.showGround,
    showGrid: config.showGrid,
    shadows: config.shadows,
    framePadding: config.framePadding,
    minDistance: config.minDistance,
    maxDistance: config.maxDistance,
    distanceMultiplier: config.distanceMultiplier,
    humanoidDistanceMultiplier: config.humanoidDistanceMultiplier,
    framingTargetNdc: config.framingTargetNdc,
    framingHardMaxNdc: config.framingHardMaxNdc,
    framingRotationSamples: config.framingRotationSamples,
    framingDistanceSafety: config.framingDistanceSafety,
  };

  return String.raw`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: ${config.background}; overflow: hidden; }
      #container { width: ${config.width}px; height: ${config.height}px; }
    </style>
  </head>
  <body>
    <div id="container"></div>
    <script type="importmap">
    {
      "imports": {
        "three": "${moduleUrls.threeUrl}",
        "three/addons/": "${moduleUrls.threeExamplesUrl}",
        "three/examples/jsm/": "${moduleUrls.threeExamplesUrl}",
        "urdf-loader": "${moduleUrls.urdfLoaderUrl}"
      }
    }
    </script>
    <script>
      window.__URDF_PREVIEW_CONFIG__ = ${JSON.stringify(payload)};
      window.__URDF_PREVIEW_ERROR__ = null;
      window.addEventListener("error", (event) => {
        window.__URDF_PREVIEW_ERROR__ = {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        };
      });
    </script>
    <script type="module">
      import * as THREE from "three";
      import URDFLoader from "urdf-loader";

      const config = window.__URDF_PREVIEW_CONFIG__;
      const container = document.getElementById("container");

      const joinUrl = (base, next) => {
        if (!base) return next;
        return base.replace(/\/+$/, "") + "/" + next.replace(/^\/+/, "");
      };

      const normalizeMeshPathForMatch = (value) =>
        value.trim().replace(/\\/g, "/").replace(/^\/+/, "");

      ${TO_MESH_REFERENCE_KEY_SOURCE}

      const WINDOWS_ABS_PATH = /^[A-Za-z]:[\\/]/;
      const parseMeshReference = (ref) => {
        const raw = ref.trim();
        if (raw.startsWith("package://")) {
          const match = raw.match(/^package:\/\/([^/]+)\/?(.*)$/);
          return {
            raw,
            scheme: "package",
            packageName: match?.[1],
            path: match?.[2] || "",
            isAbsoluteFile: false,
          };
        }
        if (raw.startsWith("file://")) {
          const path = raw.slice("file://".length);
          const isAbsoluteFile = path.startsWith("/") || WINDOWS_ABS_PATH.test(path);
          return { raw, scheme: "file", path, isAbsoluteFile };
        }
        return { raw, scheme: null, path: raw, isAbsoluteFile: false };
      };

      const normalizePath = (value) => value.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");

      const resolveFromIndex = (value) => {
        const key = normalizeMeshPathForMatch(value).toLowerCase();
        return config.meshIndex?.[key] || "";
      };

      const resolveFromReferenceIndex = (value) => {
        const key = toMeshReferenceKey(value);
        if (!key) return "";
        return config.meshReferenceIndex?.[key] || "";
      };

      const resolvePackageUri = (packageName, relativePath = "") => {
        const normalizedRelative = normalizeMeshPathForMatch(relativePath);
        const fromReferenceIndex = resolveFromReferenceIndex(
          "package://" + packageName + "/" + normalizedRelative
        );
        if (fromReferenceIndex) return fromReferenceIndex;

        if (config.packages && config.packages[packageName]) {
          return joinUrl(config.packages[packageName], normalizedRelative);
        }

        const packageCandidates = [
          packageName + "/" + normalizedRelative,
          "src/" + packageName + "/" + normalizedRelative,
          "ros_ws/src/" + packageName + "/" + normalizedRelative,
        ].filter(Boolean);
        for (const candidate of packageCandidates) {
          const fromIndex = resolveFromIndex(candidate);
          if (fromIndex) return fromIndex;
        }

        if (config.assetBaseUrl) {
          return joinUrl(config.assetBaseUrl, packageName + "/" + normalizedRelative);
        }
        return "";
      };

      const resolveAssetUrl = (assetPath) => {
        if (!assetPath) return assetPath;
        if (assetPath.startsWith("http")) return assetPath;
        if (assetPath.startsWith("blob:") || assetPath.startsWith("data:")) return assetPath;

        if (assetPath.startsWith("package://")) {
          const withoutScheme = assetPath.replace("package://", "");
          const [pkg, ...rest] = withoutScheme.split("/");
          const resolvedPackageUrl = resolvePackageUri(pkg, rest.join("/"));
          if (resolvedPackageUrl) return resolvedPackageUrl;
        }

        if (config.assetBaseUrl) {
          return joinUrl(config.assetBaseUrl, assetPath.replace(/^\.\//, ""));
        }

        const urdfDir = config.urdfUrl.split("/").slice(0, -1).join("/");
        return joinUrl(urdfDir, assetPath.replace(/^\.\//, ""));
      };

      const resolveMeshPath = (urdfDir, meshRef) => {
        const refInfo = parseMeshReference(meshRef);
        if (refInfo.isAbsoluteFile) return "";
        const meshPath = normalizeMeshPathForMatch(refInfo.path || refInfo.raw);
        if (!meshPath) return "";
        if (!urdfDir) return normalizePath(meshPath);

        const urdfParts = urdfDir.split("/").filter(Boolean);
        const meshParts = meshPath.split("/").filter(Boolean);
        const resolvedParts = [...urdfParts];
        for (const part of meshParts) {
          if (part === "..") {
            if (resolvedParts.length > 0) resolvedParts.pop();
          } else if (part !== "." && part !== "") {
            resolvedParts.push(part);
          }
        }
        return normalizePath(resolvedParts.join("/"));
      };

      const startsWithMeshFolder = (meshRef) => {
        const lower = meshRef.toLowerCase();
        return (
          lower.startsWith("meshes/") ||
          lower.startsWith("meshes\\") ||
          lower.startsWith("assets/") ||
          lower.startsWith("assets\\")
        );
      };

      const resolveMeshPathGeneric = (urdfPath, meshRef) => {
        const refInfo = parseMeshReference(meshRef);
        if (refInfo.scheme === "package" && refInfo.packageName) {
          const resolvedPackageUrl = resolvePackageUri(refInfo.packageName, refInfo.path || "");
          if (resolvedPackageUrl) return resolvedPackageUrl;
        }

        const urdfDir = urdfPath ? urdfPath.split("/").slice(0, -1).join("/") : "";
        const resolved = resolveMeshPath(urdfDir, meshRef);
        if (resolved) {
          const direct = resolveFromIndex(resolved);
          if (direct) return direct;
        }

        if (urdfDir) {
          const urdfDirParts = urdfDir.split("/").filter(Boolean);
          if (urdfDirParts.length > 0) {
            const parentDir = urdfDirParts.slice(0, -1).join("/");
            const hasMeshPrefix = startsWithMeshFolder(meshRef);
            if (hasMeshPrefix) {
              const parentResolved = resolveMeshPath(parentDir, meshRef);
              const direct = resolveFromIndex(parentResolved);
              if (direct) return direct;
            } else {
              for (const folderName of ["meshes", "assets"]) {
                const meshRefWithFolder = folderName + "/" + meshRef;
                const parentResolved = resolveMeshPath(parentDir, meshRefWithFolder);
                const direct = resolveFromIndex(parentResolved);
                if (direct) return direct;
              }
            }
          }
        }

        const normalized = normalizeMeshPathForMatch(refInfo.path || refInfo.raw);
        const direct = resolveFromIndex(normalized);
        if (direct) return direct;
        const filename = normalized.split("/").pop() || normalized;
        return config.meshFileIndex?.[filename.toLowerCase()] || "";
      };

      const rewritePackageUrisInUrdf = (urdfText) => {
        if (!urdfText || typeof urdfText !== "string") return urdfText;
        const PACKAGE_URI_RE = /package:\/\/([^/"'\s<>]+)\/([^"'\s<>]+)/g;
        return urdfText.replace(PACKAGE_URI_RE, (match, packageName, relativePath) => {
          const resolved = resolvePackageUri(packageName, relativePath);
          return resolved || match;
        });
      };

      const resolveMeshUrl = (meshPath) => {
        if (!meshPath) return "";
        if (
          meshPath.startsWith("http") ||
          meshPath.startsWith("blob:") ||
          meshPath.startsWith("data:")
        ) {
          return meshPath;
        }
        const fromReferenceIndex = resolveFromReferenceIndex(meshPath);
        if (fromReferenceIndex) return fromReferenceIndex;
        const resolved = resolveMeshPathGeneric(config.urdfPath || "", meshPath);
        if (resolved) return resolved;
        return resolveAssetUrl(meshPath);
      };

      const CONTROLLABLE_JOINT_TYPES = new Set([
        "revolute",
        "continuous",
        "prismatic",
        "planar",
        "floating",
      ]);
      const BODY_LINK_PATTERN = /(base|body|torso|chassis|trunk|pelvis)/i;
      const ARM_SIGNAL_PATTERN = /(arm|shoulder|elbow|wrist|gripper|hand|tool|flange|ee)/i;
      const LEG_SIGNAL_PATTERN = /(leg|hip|knee|ankle|thigh|calf|foot|paw)/i;
      const WHEEL_SIGNAL_PATTERN = /(wheel|caster|drive|tire)/i;
      const SIDE_LEFT_PATTERN = /(?:^|[_\-\s])(left|l)(?:$|[_\-\s])/i;
      const SIDE_RIGHT_PATTERN = /(?:^|[_\-\s])(right|r)(?:$|[_\-\s])/i;
      const SIDE_FRONT_PATTERN = /(?:^|[_\-\s])(front|f)(?:$|[_\-\s])/i;
      const SIDE_REAR_PATTERN = /(?:^|[_\-\s])(rear|back|rr)(?:$|[_\-\s])/i;
      const MAX_BODY_DEPTH_FROM_ROOT = 1;
      const WHEEL_CONTINUOUS_RATIO_THRESHOLD = 0.6;
      const WHEEL_DEPTH_THRESHOLD = 3;

      const isControllableJointType = (jointType) =>
        CONTROLLABLE_JOINT_TYPES.has(String(jointType || "").toLowerCase());

      const getSideScore = (names, pattern) =>
        names.reduce((score, value) => score + (pattern.test(value) ? 1 : 0), 0);

      const getSideHint = (names) => {
        const leftScore = getSideScore(names, SIDE_LEFT_PATTERN);
        const rightScore = getSideScore(names, SIDE_RIGHT_PATTERN);
        const frontScore = getSideScore(names, SIDE_FRONT_PATTERN);
        const rearScore = getSideScore(names, SIDE_REAR_PATTERN);
        const maxScore = Math.max(leftScore, rightScore, frontScore, rearScore);
        if (maxScore <= 0) return "center";
        if (leftScore === maxScore) return "left";
        if (rightScore === maxScore) return "right";
        if (frontScore === maxScore) return "front";
        return "rear";
      };

      const computeLinkDepthFromRoots = (roots, parentToJoints) => {
        const depthByLink = new Map();
        const queue = roots.map((link) => ({ link, depth: 0 }));
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          const existingDepth = depthByLink.get(next.link);
          if (existingDepth !== undefined && existingDepth <= next.depth) {
            continue;
          }
          depthByLink.set(next.link, next.depth);
          const children = parentToJoints.get(next.link) || [];
          children.forEach((joint) => {
            queue.push({ link: joint.childLink, depth: next.depth + 1 });
          });
        }
        return depthByLink;
      };

      const collectBranchRootJoints = (bodyLinks, parentToJoints) => {
        const branchRoots = new Map();
        bodyLinks.forEach((startLink) => {
          const stack = [startLink];
          const visitedLinks = new Set();
          while (stack.length > 0) {
            const currentLink = stack.pop();
            if (!currentLink || visitedLinks.has(currentLink)) continue;
            visitedLinks.add(currentLink);
            const joints = parentToJoints.get(currentLink) || [];
            joints.forEach((joint) => {
              if (isControllableJointType(joint.type)) {
                branchRoots.set(joint.jointName, joint);
                return;
              }
              stack.push(joint.childLink);
            });
          }
        });
        return Array.from(branchRoots.values());
      };

      const classifyBranch = (rootJoint, parentToJoints) => {
        const linkNames = new Set();
        const jointNames = new Set();
        const queue = [rootJoint];
        const visitedJoints = new Set();
        let maxDepth = 0;
        let totalJoints = 0;
        let continuousJoints = 0;
        let armSignals = 0;
        let legSignals = 0;
        let wheelSignals = 0;

        while (queue.length > 0) {
          const joint = queue.shift();
          if (!joint || visitedJoints.has(joint.jointName)) continue;
          visitedJoints.add(joint.jointName);
          jointNames.add(joint.jointName);
          linkNames.add(joint.childLink);
          totalJoints += 1;
          maxDepth = Math.max(maxDepth, joint.depth - rootJoint.depth + 1);
          if (String(joint.type || "").toLowerCase() === "continuous") {
            continuousJoints += 1;
          }
          if (ARM_SIGNAL_PATTERN.test(joint.jointName) || ARM_SIGNAL_PATTERN.test(joint.childLink)) {
            armSignals += 1;
          }
          if (LEG_SIGNAL_PATTERN.test(joint.jointName) || LEG_SIGNAL_PATTERN.test(joint.childLink)) {
            legSignals += 1;
          }
          if (WHEEL_SIGNAL_PATTERN.test(joint.jointName) || WHEEL_SIGNAL_PATTERN.test(joint.childLink)) {
            wheelSignals += 1;
          }
          const children = parentToJoints.get(joint.childLink) || [];
          children.forEach((childJoint) => queue.push(childJoint));
        }

        const continuousRatio = totalJoints > 0 ? continuousJoints / totalJoints : 0;
        const kind =
          wheelSignals > 0 ||
          (continuousRatio >= WHEEL_CONTINUOUS_RATIO_THRESHOLD && maxDepth <= WHEEL_DEPTH_THRESHOLD)
            ? "wheel"
            : legSignals > armSignals
              ? "leg"
              : "arm";
        const side = getSideHint([...jointNames, ...linkNames]);
        return { rootJoint, linkNames, jointNames, kind, side };
      };

      const summarizeJointGraph = (linkNames, orderedJoints) => {
        if (!Array.isArray(orderedJoints) || orderedJoints.length === 0) {
          return { armCount: 0, legCount: 0, wheelCount: 0 };
        }

        const cleanedLinks = Array.isArray(linkNames)
          ? linkNames.map((name) => String(name || "").trim()).filter(Boolean)
          : [];

        const parentToJoints = new Map();
        orderedJoints.forEach((joint) => {
          const byParent = parentToJoints.get(joint.parentLink);
          if (byParent) {
            byParent.push(joint);
          } else {
            parentToJoints.set(joint.parentLink, [joint]);
          }
        });

        const childLinks = new Set(orderedJoints.map((joint) => joint.childLink));
        const rootCandidates = cleanedLinks.filter((name) => !childLinks.has(name));
        const fallbackRoot = orderedJoints[0]?.parentLink || "";
        const roots = (rootCandidates.length > 0 ? rootCandidates : [fallbackRoot])
          .map((name) => name.trim())
          .filter(Boolean);
        const depthByLink = computeLinkDepthFromRoots(roots, parentToJoints);
        orderedJoints.forEach((joint) => {
          const parentDepth = depthByLink.get(joint.parentLink);
          joint.depth = (parentDepth === undefined ? 0 : parentDepth) + 1;
        });

        const bodyLinks = new Set(roots);
        cleanedLinks.forEach((linkName) => {
          const depth = depthByLink.get(linkName);
          if (
            depth !== undefined &&
            depth <= MAX_BODY_DEPTH_FROM_ROOT &&
            BODY_LINK_PATTERN.test(linkName)
          ) {
            bodyLinks.add(linkName);
          }
        });

        let branchRoots = collectBranchRootJoints(bodyLinks, parentToJoints);
        if (branchRoots.length === 0) {
          branchRoots = orderedJoints.filter((joint) => isControllableJointType(joint.type));
        }

        const branches = branchRoots.map((rootJoint) => classifyBranch(rootJoint, parentToJoints));
        const armLabels = new Set();
        const legLabels = new Set();
        const wheelLabels = new Set();
        const kindCounts = { arm: 0, leg: 0, wheel: 0 };
        const sideOrder = { left: 0, right: 1, front: 2, rear: 3, center: 4 };

        branches
          .sort((lhs, rhs) => {
            if (lhs.kind !== rhs.kind) return lhs.kind.localeCompare(rhs.kind);
            if (lhs.side !== rhs.side) return sideOrder[lhs.side] - sideOrder[rhs.side];
            return lhs.rootJoint.order - rhs.rootJoint.order;
          })
          .forEach((branch) => {
            kindCounts[branch.kind] += 1;
            const label = String(branch.kind) + String(kindCounts[branch.kind]);
            if (label.startsWith("arm")) armLabels.add(label);
            if (label.startsWith("leg")) legLabels.add(label);
            if (label.startsWith("wheel")) wheelLabels.add(label);
          });

        return {
          armCount: armLabels.size,
          legCount: legLabels.size,
          wheelCount: wheelLabels.size,
        };
      };

      const extractTopLevelRobotNodes = (urdfContent) => {
        const xml = new DOMParser().parseFromString(urdfContent, "application/xml");
        if (xml.querySelector("parsererror")) return null;
        const robotNode = xml.querySelector("robot");
        if (!robotNode) return null;
        const children = Array.from(robotNode.children || []);
        const linkNames = children
          .filter((node) => String(node.nodeName || "").toLowerCase() === "link")
          .map((node) => node.getAttribute("name")?.trim() || "")
          .filter(Boolean);
        const orderedJoints = children
          .filter((node) => String(node.nodeName || "").toLowerCase() === "joint")
          .map((node, index) => {
            const jointName = node.getAttribute("name")?.trim() || "";
            const type = node.getAttribute("type")?.trim() || "fixed";
            const jointChildren = Array.from(node.children || []);
            const parentNode = jointChildren.find(
              (child) => String(child.nodeName || "").toLowerCase() === "parent"
            );
            const childNode = jointChildren.find(
              (child) => String(child.nodeName || "").toLowerCase() === "child"
            );
            const parentLink = parentNode?.getAttribute("link")?.trim() || "";
            const childLink = childNode?.getAttribute("link")?.trim() || "";
            if (!jointName || !parentLink || !childLink) return null;
            return { jointName, type, parentLink, childLink, depth: 0, order: index };
          })
          .filter(Boolean);
        return { linkNames, orderedJoints };
      };

      const extractRobotNodesFromParsedRobot = (robot) => {
        if (!robot || typeof robot !== "object") return null;
        const linksObject =
          robot.links && typeof robot.links === "object" ? robot.links : null;
        const jointsObject =
          robot.joints && typeof robot.joints === "object" ? robot.joints : null;
        if (!linksObject && !jointsObject) return null;

        const linkNames = linksObject
          ? Object.keys(linksObject).map((name) => String(name || "").trim()).filter(Boolean)
          : [];
        const orderedJoints = jointsObject
          ? Object.values(jointsObject)
              .map((joint, index) => {
                const jointName = String(joint?.urdfName || joint?.name || "").trim();
                const type = String(joint?.jointType || "fixed").trim() || "fixed";
                const parentLink = String(
                  joint?.parent?.urdfName || joint?.parent?.name || ""
                ).trim();
                const childLink = (Array.isArray(joint?.children) ? joint.children : [])
                  .map((child) =>
                    child && (child.isURDFLink || child.type === "URDFLink")
                      ? String(child.urdfName || child.name || "").trim()
                      : ""
                  )
                  .find(Boolean);
                if (!jointName || !parentLink || !childLink) return null;
                return { jointName, type, parentLink, childLink, depth: 0, order: index };
              })
              .filter(Boolean)
          : [];
        return { linkNames, orderedJoints };
      };

      const buildRobotStructureSummary = (urdfContent, parsedRobot) => {
        try {
          const parsedRobotNodes = extractRobotNodesFromParsedRobot(parsedRobot);
          if (parsedRobotNodes && parsedRobotNodes.orderedJoints.length > 0) {
            return summarizeJointGraph(parsedRobotNodes.linkNames, parsedRobotNodes.orderedJoints);
          }
          const xmlNodes = extractTopLevelRobotNodes(urdfContent);
          if (!xmlNodes) return null;
          return summarizeJointGraph(xmlNodes.linkNames, xmlNodes.orderedJoints);
        } catch {
          return null;
        }
      };

      const transparentBackground = config.background === "transparent" || config.background === "none";
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparentBackground });
      renderer.setSize(config.width, config.height);
      renderer.setPixelRatio(config.pixelRatio);
      renderer.setClearColor(0x000000, transparentBackground ? 0 : 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.shadowMap.enabled = config.shadows !== false;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = transparentBackground ? null : new THREE.Color(config.background);

      const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
      camera.up.set(0, 0, 1);
      window.__previewCamera = camera;
      window.__previewRenderer = renderer;
      window.__previewScene = scene;

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight1.position.set(5, 5, 10);
      dirLight1.castShadow = config.shadows !== false;
      scene.add(dirLight1);

      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
      dirLight2.position.set(-5, -5, 5);
      scene.add(dirLight2);

      if (config.showGround !== false && !transparentBackground) {
        const groundGeometry = new THREE.PlaneGeometry(20, 20);
        const groundMaterial = new THREE.MeshStandardMaterial({
          color: 0x2a2a2a,
          roughness: 0.8,
          metalness: 0.0,
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.receiveShadow = config.shadows !== false;
        scene.add(ground);
      }

      if (config.showGrid !== false && !transparentBackground) {
        const grid = new THREE.GridHelper(10, 20, 0x404040, 0x303030);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = 0.001;
        scene.add(grid);
      }

      const robotGroup = new THREE.Group();
      scene.add(robotGroup);
      window.__previewRobotGroup = robotGroup;
      window.__getMeshCount__ = () => {
        let count = 0;
        robotGroup.traverse((child) => {
          if (child.isMesh) count += 1;
        });
        return count;
      };
      const meshLoadState = {
        requested: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        lastUpdateAt: Date.now(),
      };
      const touchMeshLoadState = () => {
        meshLoadState.lastUpdateAt = Date.now();
      };
      const markMeshLoadStart = () => {
        meshLoadState.requested += 1;
        meshLoadState.pending += 1;
        touchMeshLoadState();
      };
      const markMeshLoadDone = ({ failed = false } = {}) => {
        meshLoadState.pending = Math.max(0, meshLoadState.pending - 1);
        if (failed) {
          meshLoadState.failed += 1;
        } else {
          meshLoadState.completed += 1;
        }
        touchMeshLoadState();
      };
      window.__getMeshLoadState__ = () => ({ ...meshLoadState });
      window.__getPendingMeshLoads__ = () => Number(meshLoadState.pending || 0);
      window.__isMeshLoadSettled__ = () => Number(meshLoadState.pending || 0) === 0;
      window.__getRobotStats__ = () => {
        let meshCount = 0;
        let linkCount = 0;
        let jointCount = 0;
        robotGroup.traverse((child) => {
          if (child.isMesh) meshCount += 1;
          if (child.isURDFLink || child.type === "URDFLink") linkCount += 1;
          if (child.isURDFJoint || child.type === "URDFJoint") jointCount += 1;
        });
        const structure = window.__robotStructureSummary || {};
        return {
          meshCount,
          linkCount,
          jointCount,
          armCount: Number(structure.armCount || 0),
          legCount: Number(structure.legCount || 0),
          wheelCount: Number(structure.wheelCount || 0),
        };
      };

      const robotMaterial = new THREE.MeshStandardMaterial({
        color: 0x707070,
        roughness: 0.45,
        metalness: 0.15,
      });

      const manager = new THREE.LoadingManager();
      const loader = new URDFLoader(manager);
      loader.packages = config.packages || {};

      loader.loadMeshCb = (meshPath, _manager, done) => {
        const resolvedPath = resolveMeshUrl(meshPath);
        if (!resolvedPath) {
          done(new THREE.Object3D());
          return;
        }
        markMeshLoadStart();
        let settled = false;
        const finishMeshLoad = (result, failed = false) => {
          if (settled) return;
          settled = true;
          markMeshLoadDone({ failed });
          done(result || new THREE.Object3D());
        };
        const ext = resolvedPath
          .split("?")[0]
          .split("#")[0]
          .split(".")
          .pop()
          .toLowerCase();

        if (ext === "stl") {
          import("three/addons/loaders/STLLoader.js")
            .then(({ STLLoader }) => {
              new STLLoader(manager).load(
                resolvedPath,
                (geometry) => {
                  const mesh = new THREE.Mesh(geometry, robotMaterial.clone());
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                  finishMeshLoad(mesh, false);
                },
                undefined,
                (error) => {
                  console.warn("[preview] STL mesh load failed:", resolvedPath, error?.message || error);
                  finishMeshLoad(new THREE.Object3D(), true);
                }
              );
            })
            .catch((error) => {
              console.warn(
                "[preview] STL loader import failed:",
                resolvedPath,
                error?.message || error
              );
              finishMeshLoad(new THREE.Object3D(), true);
            });
          return;
        }

        if (ext === "dae") {
          import("three/addons/loaders/ColladaLoader.js")
            .then(({ ColladaLoader }) => {
              new ColladaLoader(manager).load(
                resolvedPath,
                (collada) => {
                  collada.scene.traverse((child) => {
                    if (child.isMesh) {
                      if (!child.material) {
                        child.material = robotMaterial.clone();
                      }
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  });
                  finishMeshLoad(collada.scene, false);
                },
                undefined,
                (error) => {
                  console.warn(
                    "[preview] Collada mesh load failed:",
                    resolvedPath,
                    error?.message || error
                  );
                  finishMeshLoad(new THREE.Object3D(), true);
                }
              );
            })
            .catch((error) => {
              console.warn(
                "[preview] Collada loader import failed:",
                resolvedPath,
                error?.message || error
              );
              finishMeshLoad(new THREE.Object3D(), true);
            });
          return;
        }

        if (ext === "obj") {
          import("three/addons/loaders/OBJLoader.js")
            .then(({ OBJLoader }) => {
              new OBJLoader(manager).load(
                resolvedPath,
                (object) => {
                  object.traverse((child) => {
                    if (child.isMesh) {
                      if (!child.material) {
                        child.material = robotMaterial.clone();
                      }
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  });
                  finishMeshLoad(object, false);
                },
                undefined,
                (error) => {
                  console.warn("[preview] OBJ mesh load failed:", resolvedPath, error?.message || error);
                  finishMeshLoad(new THREE.Object3D(), true);
                }
              );
            })
            .catch((error) => {
              console.warn(
                "[preview] OBJ loader import failed:",
                resolvedPath,
                error?.message || error
              );
              finishMeshLoad(new THREE.Object3D(), true);
            });
          return;
        }

        if (ext === "glb" || ext === "gltf") {
          import("three/addons/loaders/GLTFLoader.js")
            .then(({ GLTFLoader }) => {
              new GLTFLoader(manager).load(
                resolvedPath,
                (gltf) => {
                  gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  });
                  finishMeshLoad(gltf.scene, false);
                },
                undefined,
                (error) => {
                  console.warn(
                    "[preview] GLTF mesh load failed:",
                    resolvedPath,
                    error?.message || error
                  );
                  finishMeshLoad(new THREE.Object3D(), true);
                }
              );
            })
            .catch((error) => {
              console.warn(
                "[preview] GLTF loader import failed:",
                resolvedPath,
                error?.message || error
              );
              finishMeshLoad(new THREE.Object3D(), true);
            });
          return;
        }

        finishMeshLoad(new THREE.Object3D(), true);
      };

      const FRAMING_TARGET_NDC =
        Number.isFinite(config.framingTargetNdc) && config.framingTargetNdc > 0.1
          ? Math.min(0.96, Math.max(0.48, Number(config.framingTargetNdc)))
          : 0.72;
      const FRAMING_HARD_MAX_NDC =
        Number.isFinite(config.framingHardMaxNdc) && config.framingHardMaxNdc > 0.1
          ? Math.min(0.995, Math.max(0.85, Number(config.framingHardMaxNdc)))
          : 0.985;
      const FRAMING_EFFECTIVE_TARGET_NDC = Math.min(
        FRAMING_TARGET_NDC,
        Math.max(0.6, FRAMING_HARD_MAX_NDC - 0.015)
      );
      const FRAMING_ROTATION_SAMPLES =
        Number.isFinite(config.framingRotationSamples) && config.framingRotationSamples >= 8
          ? Math.min(180, Math.max(8, Math.round(Number(config.framingRotationSamples))))
          : 72;
      const FRAMING_SEARCH_STEPS = 22;
      const FRAMING_DISTANCE_SAFETY =
        Number.isFinite(config.framingDistanceSafety) && config.framingDistanceSafety >= 1
          ? Math.max(1.0, Math.min(1.5, Number(config.framingDistanceSafety)))
          : 1.08;
      const FRAMING_VIEW_DIRECTION = new THREE.Vector3(0.8, 0.8, 0.3).normalize();

      const getBoxCorners = (box) => {
        const { min, max } = box;
        return [
          new THREE.Vector3(min.x, min.y, min.z),
          new THREE.Vector3(min.x, min.y, max.z),
          new THREE.Vector3(min.x, max.y, min.z),
          new THREE.Vector3(min.x, max.y, max.z),
          new THREE.Vector3(max.x, min.y, min.z),
          new THREE.Vector3(max.x, min.y, max.z),
          new THREE.Vector3(max.x, max.y, min.z),
          new THREE.Vector3(max.x, max.y, max.z),
        ];
      };

      const measureFramingDetailed = (corners, lookTarget, distance) => {
        camera.position.copy(lookTarget).addScaledVector(FRAMING_VIEW_DIRECTION, distance);
        camera.lookAt(lookTarget);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        let maxAbsX = 0;
        let maxAbsY = 0;
        corners.forEach((corner) => {
          const projected = corner.clone().project(camera);
          if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return;
          maxAbsX = Math.max(maxAbsX, Math.abs(projected.x));
          maxAbsY = Math.max(maxAbsY, Math.abs(projected.y));
        });
        return {
          maxAbsX,
          maxAbsY,
          maxAbs: Math.max(maxAbsX, maxAbsY),
        };
      };
      const measureFraming = (corners, lookTarget, distance) =>
        measureFramingDetailed(corners, lookTarget, distance).maxAbs;

      const collectFramingCorners = (robot) => {
        const corners = [];
        const originalRotation = robotGroup.rotation.z;
        for (let index = 0; index < FRAMING_ROTATION_SAMPLES; index += 1) {
          robotGroup.rotation.z = (Math.PI * 2 * index) / FRAMING_ROTATION_SAMPLES;
          robotGroup.updateMatrixWorld(true);
          const sampleBox = new THREE.Box3().setFromObject(robot);
          if (sampleBox.isEmpty()) continue;
          corners.push(...getBoxCorners(sampleBox));
        }
        robotGroup.rotation.z = originalRotation;
        robotGroup.updateMatrixWorld(true);
        return corners;
      };

      const solveCameraDistance = ({
        corners,
        lookTarget,
        minDistance,
        maxDistance,
        seedDistance,
        targetNdc = FRAMING_EFFECTIVE_TARGET_NDC,
      }) => {
        const safeMin = Math.max(0.02, minDistance);
        const safeMax = Math.max(safeMin + 0.01, maxDistance);

        let low = safeMin;
        let high = Math.min(safeMax, Math.max(seedDistance, safeMin));
        let highFraming = measureFraming(corners, lookTarget, high);

        let expandGuard = 0;
        while (highFraming > targetNdc && high < safeMax && expandGuard < 24) {
          high = Math.min(safeMax, high * 1.35 + 0.02);
          highFraming = measureFraming(corners, lookTarget, high);
          expandGuard += 1;
        }

        if (highFraming > targetNdc) {
          return high;
        }

        for (let step = 0; step < FRAMING_SEARCH_STEPS; step += 1) {
          const mid = (low + high) / 2;
          const midFraming = measureFraming(corners, lookTarget, mid);
          if (midFraming > targetNdc) {
            low = mid;
          } else {
            high = mid;
          }
        }

        return high;
      };

      const finalize = (robot) => {
        const initialBox = new THREE.Box3().setFromObject(robot);
        if (initialBox.isEmpty()) {
          camera.position.set(2.4, 2.4, 1.6);
          camera.lookAt(0, 0, 0.6);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          window.robotReady = true;
          window.robotGroup = robotGroup;
          return;
        }
        const center = initialBox.getCenter(new THREE.Vector3());
        const minZ = initialBox.min.z;
        robot.position.set(-center.x, -center.y, -minZ);
        robotGroup.rotation.z = 0;
        robotGroup.updateMatrixWorld(true);

        const framedBox = new THREE.Box3().setFromObject(robot);
        const framedSize = framedBox.getSize(new THREE.Vector3());
        const robotCenterZ = framedSize.z / 2;
        const lookTarget = new THREE.Vector3(0, 0, robotCenterZ);
        const corners = collectFramingCorners(robot);
        const framingCorners = corners.length > 0 ? corners : getBoxCorners(framedBox);

        const aspectRatio = framedSize.z / Math.max(framedSize.x, framedSize.y, 0.01);
        const isHumanoid = aspectRatio > 2.5;
        const maxDim = Math.max(framedSize.x, framedSize.y, framedSize.z, 0.01);
        const fov = camera.fov * (Math.PI / 180);
        const fitDistance = (maxDim / 2) / Math.tan(fov / 2);
        const distanceMultiplier = isHumanoid
          ? Math.max(1.2, config.humanoidDistanceMultiplier ?? 1.2)
          : Math.max(1.35, config.distanceMultiplier ?? 1.6);
        const padding = Math.max(1.2, config.framePadding ?? 1.4);
        const minDistance = config.minDistance ?? 0.08;
        const maxDistance = config.maxDistance ?? 50;
        const seedDistance = Math.min(
          Math.max(fitDistance * distanceMultiplier * padding, minDistance),
          maxDistance
        );
        const solvedDistance = solveCameraDistance({
          corners: framingCorners,
          lookTarget,
          minDistance,
          maxDistance,
          seedDistance,
          targetNdc: FRAMING_EFFECTIVE_TARGET_NDC,
        });
        let cameraDistance = Math.min(maxDistance, solvedDistance * FRAMING_DISTANCE_SAFETY);
        let framingCoverage = measureFraming(framingCorners, lookTarget, cameraDistance);
        if (framingCoverage > FRAMING_EFFECTIVE_TARGET_NDC && cameraDistance < maxDistance) {
          const requiredScale = Math.max(
            1.02,
            framingCoverage / Math.max(0.2, FRAMING_EFFECTIVE_TARGET_NDC)
          );
          cameraDistance = Math.min(maxDistance, cameraDistance * requiredScale * 1.02);
          framingCoverage = measureFraming(framingCorners, lookTarget, cameraDistance);
        }
        let framingMetrics = measureFramingDetailed(framingCorners, lookTarget, cameraDistance);
        if (framingMetrics.maxAbs > FRAMING_HARD_MAX_NDC && cameraDistance < maxDistance) {
          const requiredScale = Math.max(
            1.01,
            framingMetrics.maxAbs / Math.max(0.2, FRAMING_HARD_MAX_NDC)
          );
          cameraDistance = Math.min(maxDistance, cameraDistance * requiredScale * 1.01);
          framingCoverage = measureFraming(framingCorners, lookTarget, cameraDistance);
          framingMetrics = measureFramingDetailed(framingCorners, lookTarget, cameraDistance);
        }

        camera.position.copy(lookTarget).addScaledVector(FRAMING_VIEW_DIRECTION, cameraDistance);
        camera.lookAt(lookTarget);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const getCurrentFramingMetrics = () => {
          const liveRobot = robotGroup.children?.[0];
          if (!liveRobot) return { coverage: 0, maxAbsX: 0, maxAbsY: 0 };
          robotGroup.updateMatrixWorld(true);
          const liveBox = new THREE.Box3().setFromObject(liveRobot);
          if (liveBox.isEmpty()) return { coverage: 0, maxAbsX: 0, maxAbsY: 0 };
          const liveMetrics = measureFramingDetailed(getBoxCorners(liveBox), lookTarget, cameraDistance);
          return {
            coverage: liveMetrics.maxAbs,
            maxAbsX: liveMetrics.maxAbsX,
            maxAbsY: liveMetrics.maxAbsY,
          };
        };
        const getCurrentFramingCoverage = () => {
          return getCurrentFramingMetrics().coverage;
        };

        window.__framingCoverage = framingCoverage;
        window.__framingTargetNdc = FRAMING_TARGET_NDC;
        window.__framingHardMaxNdc = FRAMING_HARD_MAX_NDC;
        window.__framingMetrics = framingMetrics;
        window.__getCurrentFramingMetrics__ = getCurrentFramingMetrics;
        window.__getCurrentFramingCoverage__ = getCurrentFramingCoverage;

        window.robotReady = true;
        window.robotGroup = robotGroup;
      };

      const tryFinalizeRobot = (force = false) => {
        if (window.robotReady) return true;
        const robot = robotGroup.children[0];
        if (!robot) return false;
        if (
          !force &&
          typeof window.__getPendingMeshLoads__ === "function" &&
          window.__getPendingMeshLoads__() > 0
        ) {
          return false;
        }
        finalize(robot);
        return true;
      };

      manager.onLoad = () => {
        tryFinalizeRobot(false);
      };

      window.setBackgroundView = () => {
        camera.position.set(2.4, 2.4, 1.6);
        camera.lookAt(0, 0, 0.6);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };

      const loadRobot = async () => {
        try {
          const urdfRes = await fetch(config.urdfUrl);
          if (!urdfRes.ok) {
            throw new Error("URDF fetch failed: HTTP " + urdfRes.status);
          }

          const rawUrdfContent = await urdfRes.text();
          const urdfContent = rewritePackageUrisInUrdf(rawUrdfContent);
          if (!/<robot[\s>]/i.test(urdfContent)) {
            throw new Error("Invalid URDF: missing <robot> root node");
          }
          if (!/(<mesh\b|<box\b|<cylinder\b|<sphere\b|<capsule\b)/i.test(urdfContent)) {
            throw new Error("No renderable geometry found in URDF");
          }

          const robot = loader.parse(urdfContent);
          if (!robot || typeof robot.traverse !== "function") {
            throw new Error("URDF parse returned no renderable robot tree");
          }

          window.__robotStructureSummary = buildRobotStructureSummary(urdfContent, robot);
          robotGroup.add(robot);

          const fallbackWindowMs =
            Number.isFinite(config.meshLoadFallbackMs) && config.meshLoadFallbackMs > 0
              ? Math.min(20000, Math.max(3000, Number(config.meshLoadFallbackMs)))
              : 9000;
          const fallbackStartedAt = Date.now();
          const fallbackTimer = setInterval(() => {
            if (window.robotReady) {
              clearInterval(fallbackTimer);
              return;
            }

            const settled =
              typeof window.__isMeshLoadSettled__ === "function"
                ? window.__isMeshLoadSettled__()
                : true;
            if (settled && tryFinalizeRobot(false)) {
              clearInterval(fallbackTimer);
              return;
            }

            if (Date.now() - fallbackStartedAt >= fallbackWindowMs) {
              const pending =
                typeof window.__getPendingMeshLoads__ === "function"
                  ? window.__getPendingMeshLoads__()
                  : 0;
              console.warn(
                "[preview] mesh-load fallback reached, forcing finalize with pending meshes:",
                pending
              );
              tryFinalizeRobot(true);
              clearInterval(fallbackTimer);
            }
          }, 250);
        } catch (error) {
          console.error("Failed to load robot:", error);
          window.robotError = error?.message || "Failed to load robot";
        }
      };

      loadRobot();

      const animate = () => {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();

      window.setRotation = (angle) => {
        if (window.robotGroup) {
          window.robotGroup.rotation.z = angle;
        }
      };
    </script>
  </body>
</html>`;
};
