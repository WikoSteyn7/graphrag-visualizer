import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  CustomGraphData,
  CustomLink,
  CustomNode,
} from "../models/custom-graph-data";
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  IconButton,
  Switch,
  Tooltip,
  Typography,
  useTheme,
  CircularProgress,
} from "@mui/material";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import SearchIcon from "@mui/icons-material/Search";
import Fuse from "fuse.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer";
import * as THREE from "three";
import { Renderer } from "three";
import SearchDrawer from "./SearchDrawer";
import DetailDrawer from "./DetailDrawer";
import { SearchResult } from "../models/search-result";
import agent from "../api/agent";
import APISearchDrawer from "./APISearchDrawer";
import SpriteText from "three-spritetext";
import { TextureLoader } from 'three';
import { debounce } from 'lodash';
import { WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { Vector2 } from 'three';
import * as d3 from 'd3';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';

interface GraphViewerProps {
  data: CustomGraphData;
  graphType: "2d" | "3d";
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleGraphType: (event: React.ChangeEvent<HTMLInputElement>) => void;
  includeDocuments: boolean;
  onIncludeDocumentsChange: React.Dispatch<React.SetStateAction<boolean>>;
  includeTextUnits: boolean;
  onIncludeTextUnitsChange: React.Dispatch<React.SetStateAction<boolean>>;
  includeCommunities: boolean;
  onIncludeCommunitiesChange: React.Dispatch<React.SetStateAction<boolean>>;
  includeCovariates: boolean;
  onIncludeCovariatesChange: React.Dispatch<React.SetStateAction<boolean>>;
  hasDocuments: boolean;
  hasTextUnits: boolean;
  hasCommunities: boolean;
  hasCovariates: boolean;
}

const NODE_R = 6;
const padding = 4;
const BLOOM_PARAMS = {
  exposure: 1,
  bloomStrength: 1.5,
  bloomThreshold: 0.1,
  bloomRadius: 0.8
};

const GLASS_EFFECT = {
  innerRadius: NODE_R * 0.85,
  outerRadius: NODE_R,
  gradientOffset: NODE_R * 0.15,
  shadowBlur: 8,
  shadowColor: 'rgba(0,0,0,0.3)',
  glowStrength: 0.6,
  innerGlowSize: NODE_R * 0.4,
  borderWidth: 1,
  highlightIntensity: 0.8
};

const PARTICLE_EFFECT = {
  particleSize: 4,
  particleSpeed: 0.2,
  particleCount: 6,
  particleOpacity: 0.8,
  trailLength: 0.3,
  glowSize: 4
};

const ANIMATION_CONFIG = {
  amplitude: 0.5,     // Reduced movement amplitude
  frequency: 0.001,   // Slower, smoother movement
  phaseShift: 0.3,    // Reduced phase shift
  centerPull: 0.05    // Gentler center pull
};

const createOscillation = (time: number, seed: number) => {
  const t = time * ANIMATION_CONFIG.frequency;
  const phase = seed * ANIMATION_CONFIG.phaseShift;
  return Math.sin(t + phase) * ANIMATION_CONFIG.amplitude;
};

const NODE_COLORS = {
  ORGANIZATION: '#4CAF50',  // Green
  EVENT: '#2196F3',        // Blue
  GEO: '#9C27B0',         // Purple
  PERSON: '#FF9800',      // Orange
  default: '#607D8B'       // Blue Grey
};

const ANIMATION_3D = {
  rotationSpeed: 0.001,
  pulseFrequency: 0.5,
  glowIntensity: 1.2,
  particleSpeed: 0.02,
  cameraDistance: 300,
  autoRotate: true
};

const GraphViewer: React.FC<GraphViewerProps> = ({
  data,
  graphType,
  isFullscreen,
  includeDocuments,
  onIncludeDocumentsChange,
  includeTextUnits,
  onIncludeTextUnitsChange,
  includeCommunities,
  onIncludeCommunitiesChange,
  includeCovariates,
  onIncludeCovariatesChange,
  onToggleFullscreen,
  onToggleGraphType,
  hasDocuments,
  hasTextUnits,
  hasCommunities,
  hasCovariates,
}) => {
  const theme = useTheme();
  const [highlightNodes, setHighlightNodes] = useState<Set<CustomNode>>(
    new Set()
  );
  const [highlightLinks, setHighlightLinks] = useState<Set<CustomLink>>(
    new Set()
  );
  const [hoverNode, setHoverNode] = useState<CustomNode | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<
    (CustomNode | CustomLink)[]
  >([]);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [bottomDrawerOpen, setBottomDrawerOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<CustomNode | null>(null);
  const [selectedRelationship, setSelectedRelationship] =
    useState<CustomLink | null>(null);
  const [linkedNodes, setLinkedNodes] = useState<CustomNode[]>([]);
  const [linkedRelationships, setLinkedRelationships] = useState<CustomLink[]>(
    []
  );
  const [showLabels, setShowLabels] = useState(false);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);
  const graphRef = useRef<any>();
  const extraRenderers = [new CSS2DRenderer() as any as Renderer];
  const nodeCount = data.nodes.length;
  const linkCount = data.links.length;

  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [apiSearchResults, setApiSearchResults] = useState<SearchResult | null>(
    null
  );
  const [serverUp, setServerUp] = useState<boolean>(false);

  const [graphData, setGraphData] = useState<CustomGraphData>(data);

  const initialGraphData = useRef<CustomGraphData>(data);

  const [graphZoom, setGraphZoom] = useState(1);

  const [workerRunning, setWorkerRunning] = useState(false);

  const [clusterThreshold] = useState(100);

  const textureLoader = useMemo(() => new TextureLoader(), []);

  const [composer, setComposer] = useState<EffectComposer | null>(null);
  const [renderer, setRenderer] = useState<WebGLRenderer | null>(null);

  const [visibleNodes, setVisibleNodes] = useState<CustomNode[]>([]);

  const [animationFrame, setAnimationFrame] = useState<number>(0);

  useEffect(() => {
    if (graphType === '3d' && graphRef.current) {
      const renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(graphRef.current.scene(), graphRef.current.camera());
      const bloomPass = new UnrealBloomPass(
        new Vector2(window.innerWidth, window.innerHeight),
        BLOOM_PARAMS.bloomStrength,
        BLOOM_PARAMS.bloomRadius,
        BLOOM_PARAMS.bloomThreshold
      );

      composer.addPass(renderPass);
      composer.addPass(bloomPass);

      setRenderer(renderer);
      setComposer(composer);

      return () => {
        composer.dispose();
        renderer.dispose();
      };
    }
  }, [graphType]);

  useEffect(() => {
    let frameId: number;
    let lastTime = performance.now();
    const fps = 60;
    const frameInterval = 1000 / fps;

    const animate = (currentTime: number) => {
      frameId = requestAnimationFrame(animate);

      const deltaTime = currentTime - lastTime;
      if (deltaTime < frameInterval) return;

      if (graphRef.current && graphType === "2d" && graphRef.current._graphData) {
        const graphData = graphRef.current._graphData;
        if (!graphData || !Array.isArray(graphData.nodes)) return;

        const time = currentTime * 0.001; // Convert to seconds
        
        graphData.nodes.forEach((node: CustomNode) => {
          if (!node.x || !node.y) return;
          
          if (!node.initialX) {
            node.initialX = node.x;
            node.initialY = node.y;
            node.animationSeed = parseInt(node.id.toString(), 36) % 1000 / 1000;
          }

          const xOffset = createOscillation(time, node.animationSeed!);
          const yOffset = createOscillation(time + 1000, node.animationSeed!);

          node.x = node.initialX + xOffset;
          node.y = node.initialY + yOffset;
        });

        graphRef.current.refresh();
        lastTime = currentTime - (deltaTime % frameInterval);
      }
    };

    frameId = requestAnimationFrame(animate);
    
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [graphType]);

  const clusterNodes = (nodes: CustomNode[], threshold: number) => {
    const clusters: { [key: string]: CustomNode[] } = {};
    nodes.forEach((node) => {
      const clusterKey = `${Math.round(node.x! / threshold)},${Math.round(node.y! / threshold)}`;
      if (!clusters[clusterKey]) clusters[clusterKey] = [];
      clusters[clusterKey].push(node);
    });
    
    return Object.values(clusters).map((cluster) => {
      if (cluster.length === 1) return cluster[0];
      return {
        id: `cluster-${cluster.map(n => n.id).join('-')}`,
        uuid: `cluster-${cluster.map(n => n.uuid).join('-')}`,
        name: `Cluster (${cluster.length})`,
        type: 'cluster',
        size: Math.sqrt(cluster.length) * NODE_R,
        cluster: true,
        nodes: cluster
      } as CustomNode;
    });
  };

  const optimizedNodes = useMemo(() => 
    data.nodes.map(node => ({
      ...node,
      // Pre-calculate frequently accessed properties
      degree: node.neighbors?.length || 0,
      // Remove unnecessary properties for rendering
      __threeObj: undefined,
      index: undefined
    })), [data.nodes]);
    
  const clusteredData = useMemo(() => ({
    nodes: graphZoom < 0.5 ? clusterNodes(data.nodes, clusterThreshold) : data.nodes,
    links: data.links
  }), [data, graphZoom, clusterThreshold]);

  const graphDataMemo = useMemo(() => ({
    nodes: optimizedNodes,
    links: data.links
  }), [optimizedNodes, data.links]);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    setGraphData(data);
    initialGraphData.current = data;
  }, [data]);

  useEffect(() => {
    checkServerStatus();
  }, []);

  useEffect(() => {
    if (!workerRunning && data.nodes.length > 1000) {
      const worker = new Worker(`${process.env.PUBLIC_URL}/forceWorker.ts`);
      worker.postMessage(data);
      worker.onmessage = (event) => {
        setGraphData(event.data);
        setWorkerRunning(false);
      };
      setWorkerRunning(true);
    }
  }, [data, workerRunning]);

  useEffect(() => {
    const chunkSize = 100;
    let currentIndex = 0;
    
    const addNodes = () => {
      const nextNodes = data.nodes.slice(currentIndex, currentIndex + chunkSize);
      setVisibleNodes(prev => [...prev, ...nextNodes]);
      currentIndex += chunkSize;
      
      if (currentIndex < data.nodes.length) {
        requestAnimationFrame(addNodes);
      }
    };
    
    setVisibleNodes([]); // Reset when data changes
    requestAnimationFrame(addNodes);
  }, [data]);

  const toggleApiDrawer = (open: boolean) => () => {
    if (open) {
      onIncludeTextUnitsChange(true);
      onIncludeCommunitiesChange(true);
      if (hasCovariates) {
        onIncludeCovariatesChange(true);
      }
    }
    setApiDrawerOpen(open);
  };

  const handleApiSearch = async (
    query: string,
    searchType: "local" | "global"
  ) => {
    try {
      const data: SearchResult =
        searchType === "local"
          ? await agent.Search.local(query)
          : await agent.Search.global(query);

      setApiSearchResults(data);
      // Process the search result to update the graph data
      updateGraphData(data.context_data);
    } catch (err) {
      console.error("An error occurred during the API search.", err);
    } finally {
    }
  };

  const checkServerStatus = async () => {
    try {
      const response = await agent.Status.check();
      if (response.status === "Server is up and running") {
        setServerUp(true);
      } else {
        setServerUp(false);
      }
    } catch (error) {
      setServerUp(false);
    }
  };

  const updateGraphData = (contextData: any) => {
    if (!contextData) return;

    const newNodes: CustomNode[] = [];
    const newLinks: CustomLink[] = [];

    const baseGraphData = initialGraphData.current;

    // Assuming contextData has keys like entities, reports, relationships, sources
    Object.entries(contextData).forEach(([key, items]) => {
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (key === "relationships") {
            // Handle links
            const existingLink = baseGraphData.links.find(
              (link) =>
                link.human_readable_id?.toString() === item.id.toString()
            );

            if (existingLink) {
              newLinks.push(existingLink);
            }
          } else if (key === "entities") {
            const existingNode = baseGraphData.nodes.find(
              (node) =>
                node.human_readable_id?.toString() === item.id.toString() &&
                !node.covariate_type
            );
            if (existingNode) {
              newNodes.push(existingNode);
            }
          } else if (key === "reports") {
            const existingNode = baseGraphData.nodes.find(
              (node) => node.uuid === item.id.toString()
            );
            if (existingNode) {
              newNodes.push(existingNode);
            }
          } else if (key === "sources") {
            const existingNode = baseGraphData.nodes.find(
              (node) => node.text?.toString() === item.text
            );
            if (existingNode) {
              newNodes.push(existingNode);
            }
          } else if (key === "covariates" || key === "claims") {
            const existingNode = baseGraphData.nodes.find(
              (node) =>
                node.human_readable_id?.toString() === item.id.toString() &&
                node.covariate_type
            );
            if (existingNode) {
              newNodes.push(existingNode);
            }
          }
        });
      }
    });

    // Update the graph data with the new nodes and links
    const updatedGraphData: CustomGraphData = {
      nodes: [...newNodes],
      links: [...newLinks],
    };

    // Set the updated data to trigger re-render
    setGraphData(updatedGraphData);
  };

  const fuse = new Fuse([...data.nodes, ...data.links], {
    keys: [
      "uuid",
      "id",
      "name",
      "type",
      "description",
      "source",
      "target",
      "title",
      "summary",
    ],
    threshold: 0.3,
  });

  const handleNodeHover = useCallback((node: CustomNode | null) => {
    const newHighlightNodes = new Set<CustomNode>();
    const newHighlightLinks = new Set<CustomLink>();

    if (node) {
      newHighlightNodes.add(node);
      node.neighbors?.forEach((neighbor) => newHighlightNodes.add(neighbor));
      node.links?.forEach((link) => newHighlightLinks.add(link));
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
    setHoverNode(node);
  }, []);

  const handleLinkHover = useCallback((link: CustomLink | null) => {
    const newHighlightNodes = new Set<CustomNode>();
    const newHighlightLinks = new Set<CustomLink>();

    if (link) {
      newHighlightLinks.add(link);
      if (typeof link.source !== "string") newHighlightNodes.add(link.source);
      if (typeof link.target !== "string") newHighlightNodes.add(link.target);
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
  }, []);

  const paintRing = useCallback(
    (node: CustomNode, ctx: CanvasRenderingContext2D) => {
      const { x, y } = node;
      if (!x || !y) return;

      const nodeType = node.type || 'default';
      const baseColor = NODE_COLORS[nodeType as keyof typeof NODE_COLORS] || NODE_COLORS.default;
      const isHighlighted = highlightNodes.has(node);
      const isHovered = node === hoverNode;

      ctx.save();

      // Base shadow
      ctx.shadowColor = GLASS_EFFECT.shadowColor;
      ctx.shadowBlur = GLASS_EFFECT.shadowBlur;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      // Main node
      ctx.beginPath();
      ctx.arc(x, y, GLASS_EFFECT.outerRadius, 0, 2 * Math.PI);
      
      const gradient = ctx.createRadialGradient(
        x - GLASS_EFFECT.gradientOffset,
        y - GLASS_EFFECT.gradientOffset,
        0,
        x,
        y,
        GLASS_EFFECT.outerRadius
      );

      if (isHighlighted) {
        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(0.7, baseColor + 'dd');
        gradient.addColorStop(1, baseColor + 'aa');
      } else {
        const isDark = theme.palette.mode === 'dark';
        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(1, baseColor + '44');
      }

      ctx.fillStyle = gradient;
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = isHighlighted 
        ? `${baseColor}cc`
        : theme.palette.mode === 'dark' 
          ? 'rgba(255,255,255,0.2)' 
          : 'rgba(0,0,0,0.1)';
      ctx.lineWidth = GLASS_EFFECT.borderWidth;
      ctx.stroke();

      // Top highlight for depth
      ctx.beginPath();
      ctx.arc(
        x - GLASS_EFFECT.gradientOffset * 0.5,
        y - GLASS_EFFECT.gradientOffset * 0.5,
        GLASS_EFFECT.innerRadius * 0.7,
        0,
        2 * Math.PI
      );
      const highlightGradient = ctx.createRadialGradient(
        x - GLASS_EFFECT.gradientOffset * 0.5,
        y - GLASS_EFFECT.gradientOffset * 0.5,
        0,
        x - GLASS_EFFECT.gradientOffset * 0.5,
        y - GLASS_EFFECT.gradientOffset * 0.5,
        GLASS_EFFECT.innerRadius * 0.7
      );
      highlightGradient.addColorStop(0, 'rgba(255,255,255,0.15)');
      highlightGradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      ctx.restore();
    },
    [hoverNode, highlightNodes, theme.palette.mode]
  );

  const handleSearch = () => {
    const results = fuse.search(searchTerm).map((result) => result.item);
    const nodeResults = results.filter((item) => "neighbors" in item);
    const linkResults = results.filter(
      (item) => "source" in item && "target" in item
    );
    setSearchResults([...nodeResults, ...linkResults]);
    setRightDrawerOpen(true);
  };

  const toggleDrawer = (open: boolean) => () => {
    setRightDrawerOpen(open);
  };

  const handleFocusButtonClick = (node: CustomNode) => {
    const newHighlightNodes = new Set<CustomNode>();
    newHighlightNodes.add(node);
    node.neighbors?.forEach((neighbor) => newHighlightNodes.add(neighbor));
    node.links?.forEach((link) => highlightLinks.add(link));

    setHighlightNodes(newHighlightNodes);
    setHoverNode(node);

    if (graphRef.current) {
      if (graphType === "2d") {
        graphRef.current.centerAt(node.x, node.y, 1000);
        graphRef.current.zoom(8, 1000);
      } else {
        graphRef.current.cameraPosition(
          { x: node.x, y: node.y, z: 300 }, // new position
          { x: node.x, y: node.y, z: 0 }, // lookAt
          3000 // ms transition duration
        );
      }
    }

    // Simulate mouse hover on the focused node
    setTimeout(() => {
      handleNodeHover(node);
    }, 1000); // Adjust delay as needed

    setRightDrawerOpen(false);
  };

  const handleFocusLinkClick = (link: CustomLink) => {
    const newHighlightNodes = new Set<CustomNode>();
    const newHighlightLinks = new Set<CustomLink>();

    newHighlightLinks.add(link);
    let sourceNode: CustomNode | undefined;
    let targetNode: CustomNode | undefined;

    if (typeof link.source !== "string") {
      newHighlightNodes.add(link.source);
      sourceNode = link.source;
    }

    if (typeof link.target !== "string") {
      newHighlightNodes.add(link.target);
      targetNode = link.target;
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);

    if (
      graphRef.current &&
      sourceNode &&
      targetNode &&
      sourceNode.x &&
      targetNode.x &&
      sourceNode.y &&
      targetNode.y
    ) {
      const midX = (sourceNode.x + targetNode.x) / 2;
      const midY = (sourceNode.y + targetNode.y) / 2;

      if (graphType === "2d") {
        graphRef.current.centerAt(midX, midY, 1000);
        graphRef.current.zoom(8, 1000);
      } else {
        graphRef.current.cameraPosition(
          { x: midX, y: midY, z: 300 }, // new position
          { x: midX, y: midY, z: 0 }, // lookAt
          3000 // ms transition duration
        );
      }
    }

    // Simulate mouse hover on the focused link
    setTimeout(() => {
      handleLinkHover(link);
    }, 1000); // Adjust delay as needed

    setRightDrawerOpen(false);
  };

  const handleNodeClick = (node: CustomNode) => {
    setSelectedRelationship(null);
    setSelectedNode(node);
    setLinkedNodes(node.neighbors || []);
    setLinkedRelationships(node.links || []);
    setBottomDrawerOpen(true);
  };

  const handleLinkClick = (link: CustomLink) => {
    setSelectedNode(null);
    setSelectedRelationship(link);
    const linkSource =
      typeof link.source === "object"
        ? (link.source as CustomNode).id
        : link.source;
    const linkTarget =
      typeof link.target === "object"
        ? (link.target as CustomNode).id
        : link.target;
    const sourceNode = data.nodes.find((node) => node.id === linkSource);
    const targetNode = data.nodes.find((node) => node.id === linkTarget);
    if (sourceNode && targetNode) {
      const linkedNodes = [sourceNode, targetNode];
      setLinkedNodes(linkedNodes);
      const linkedRelationships = [link];
      setLinkedRelationships(linkedRelationships);
      setBottomDrawerOpen(true);
    }
  };

  const getBackgroundColor = () =>
    theme.palette.mode === "dark" ? "#000000" : "#FFFFFF";

  const getLinkColor = (link: CustomLink) =>
    theme.palette.mode === "dark" ? "gray" : "lightgray";

  const get3DLinkColor = (link: CustomLink) =>
    theme.palette.mode === "dark" ? "lightgray" : "gray";

  const getlinkDirectionalParticleColor = (link: CustomLink) =>
    theme.palette.mode === "dark" ? "lightgray" : "gray";

  const renderNodeLabel = useCallback((node: CustomNode, ctx: CanvasRenderingContext2D) => {
    if (!showLabels || graphZoom < 0.7) return;

    const label = node.name || "";
    const fontSize = Math.min(4 * graphZoom, 8);
    ctx.font = `${fontSize}px Sans-Serif`;

    // Use alpha based on zoom level for smooth fade in/out
    const alpha = Math.min((graphZoom - 0.7) / 0.3, 1);
    ctx.globalAlpha = alpha;

    // Set the styles based on the theme mode
    const backgroundColor =
      theme.palette.mode === "dark"
        ? "rgba(0, 0, 0, 0.6)"
        : "rgba(255, 255, 255, 0.6)";

    // Calculate label dimensions
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = fontSize + padding * 2;

    if (node.x && node.y) {
      // Draw the background rectangle with rounded corners
      ctx.fillStyle = backgroundColor;
      ctx.beginPath();
      ctx.moveTo(node.x - boxWidth / 2 + 5, node.y - boxHeight / 2);
      ctx.lineTo(node.x + boxWidth / 2 - 5, node.y - boxHeight / 2);
      ctx.quadraticCurveTo(
        node.x + boxWidth / 2,
        node.y - boxHeight / 2,
        node.x + boxWidth / 2,
        node.y - boxHeight / 2 + 5
      );
      ctx.lineTo(node.x + boxWidth / 2, node.y + boxHeight / 2 - 5);
      ctx.quadraticCurveTo(
        node.x + boxWidth / 2,
        node.y + boxHeight / 2,
        node.x + boxWidth / 2 - 5,
        node.y + boxHeight / 2
      );
      ctx.lineTo(node.x - boxWidth / 2 + 5, node.y + boxHeight / 2);
      ctx.quadraticCurveTo(
        node.x - boxWidth / 2,
        node.y + boxHeight / 2,
        node.x - boxWidth / 2,
        node.y + boxHeight / 2 - 5
      );
      ctx.lineTo(node.x - boxWidth / 2, node.y - boxHeight / 2 + 5);
      ctx.quadraticCurveTo(
        node.x - boxWidth / 2,
        node.y - boxHeight / 2,
        node.x - boxWidth / 2 + 5,
        node.y - boxHeight / 2
      );
      ctx.closePath();
      ctx.fill();

      // Draw the text in the center of the node
      // ctx.fillStyle = textColor;
      ctx.fillStyle = node.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, node.x, node.y);
    }

    ctx.globalAlpha = 1; // Reset alpha
  }, [showLabels, graphZoom]);

  const nodeThreeObject = useCallback((node: CustomNode) => {
    if (!showLabels) {
      const geometry = new THREE.SphereGeometry(NODE_R * 0.8, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color: node.color || '#ffffff',
        emissive: node.color || '#ffffff',
        emissiveIntensity: 0.3,
        shininess: 50,
        transparent: true,
        opacity: 0.9
      });
      const sphere = new THREE.Mesh(geometry, material);
      return sphere;
    }

    const nodeEl = document.createElement("div");
    nodeEl.textContent = node.name || node.id;
    nodeEl.style.color = node.color || '#ffffff';
    nodeEl.style.padding = "2px 4px";
    nodeEl.style.borderRadius = "4px";
    nodeEl.style.fontSize = "10px";
    nodeEl.className = "node-label";

    const label = new CSS2DObject(nodeEl);
    label.position.set(0, NODE_R, 0);
    return label;
  }, [showLabels]);

  const localSearchEnabled = hasCovariates
    ? includeTextUnits && includeCommunities && includeCovariates
    : includeTextUnits && includeCommunities;

  // const clearSearchResults = () => {
  //   setGraphData(initialGraphData.current);
  //   setApiSearchResults(null);
  // };

  const debouncedHandleNodeHover = useCallback(
    debounce((node: CustomNode | null) => {
      handleNodeHover(node);
    }, 100),
    [handleNodeHover]
  );

  const debouncedHandleZoom = useCallback(
    debounce((zoom: { k: number }) => {
      setGraphZoom(zoom.k);
    }, 100),
    []
  );

  // Add memoized filtered data
  const filteredGraphData = useMemo(() => {
    const filteredNodes = optimizedNodes.filter(node => {
      switch (node.type?.toLowerCase()) {
        case 'textunit':
          return includeTextUnits;
        case 'community':
          return includeCommunities;
        case 'covariate':
          return includeCovariates;
        case 'document':
          return includeDocuments;
        default:
          return true;
      }
    });

    const nodeIds = new Set(filteredNodes.map((node: CustomNode) => node.id));
    const filteredLinks = data.links.filter(link => 
      nodeIds.has(typeof link.source === 'object' ? (link.source as CustomNode).id : link.source) &&
      nodeIds.has(typeof link.target === 'object' ? (link.target as CustomNode).id : link.target)
    );

    return {
      nodes: filteredNodes,
      links: filteredLinks
    };
  }, [optimizedNodes, data.links, includeTextUnits, includeCommunities, includeCovariates, includeDocuments]);

  return (
    <Box
      sx={{
        height: isFullscreen ? "100vh" : "calc(100vh - 64px)",
        width: isFullscreen ? "100vw" : "100%",
        position: isFullscreen ? "fixed" : "relative",
        top: 0,
        left: 0,
        zIndex: isFullscreen ? 1300 : "auto",
        overflow: "hidden",
        margin: 0,
        padding: 0,
        backgroundColor: getBackgroundColor(),
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 1400,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          alignItems: "flex-end",
        }}
      >
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <Button
            variant="contained"
            onClick={toggleDrawer(true)}
            startIcon={<SearchIcon />}
          >
            Search Nodes/Links
          </Button>
          {/* <FormControlLabel
            control={
              <Switch
                checked={graphType === "3d"}
                onChange={onToggleGraphType}
              />
            }
            label="3D View"
          /> */}
          {/* <FormControlLabel
            control={
              <Switch
                checked={showLabels}
                onChange={() => setShowLabels(!showLabels)}
              />
            }
            label="Show Node Labels"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showLinkLabels}
                onChange={() => setShowLinkLabels(!showLinkLabels)}
              />
            }
            label="Show Relationship Labels"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showHighlight}
                onChange={() => setShowHighlight(!showHighlight)}
              />
            }
            label="Show Highlight"
          /> */}
          <Tooltip title={isFullscreen ? "Exit Full Screen" : "Full Screen"}>
            <IconButton onClick={onToggleFullscreen} color="inherit">
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            alignItems: "flex-start",
          }}
        >
          <FormControlLabel
            control={
              <Switch
                checked={graphType === "3d"}
                onChange={onToggleGraphType}
              />
            }
            label="3D View"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showLabels}
                onChange={() => setShowLabels(!showLabels)}
              />
            }
            label="Show Node Labels"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showLinkLabels}
                onChange={() => setShowLinkLabels(!showLinkLabels)}
              />
            }
            label="Show Link Labels"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showHighlight}
                onChange={() => setShowHighlight(!showHighlight)}
              />
            }
            label="Show Highlight"
          />
        </Box>

        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={includeDocuments}
                onChange={() => onIncludeDocumentsChange(!includeDocuments)}
                disabled={!hasDocuments || apiSearchResults !== null}
              />
            }
            label="Include Documents"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={includeTextUnits}
                // onChange={() => onIncludeTextUnitsChange(!includeTextUnits)}
                onChange={() => {
                  if (!includeTextUnits) {
                    onIncludeTextUnitsChange(true);
                  } else if (includeTextUnits && !includeCovariates) {
                    onIncludeTextUnitsChange(false);
                  } else {
                    onIncludeTextUnitsChange(false);
                    onIncludeCovariatesChange(false); // Uncheck Covariates when Text Units is unchecked
                  }
                }}
                disabled={!hasTextUnits || apiSearchResults !== null}
              />
            }
            label="Include Text Units"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={includeCommunities}
                onChange={() => onIncludeCommunitiesChange(!includeCommunities)}
                disabled={!hasCommunities || apiSearchResults !== null}
              />
            }
            label="Include Communities"
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={includeCovariates}
                onChange={() => {
                  if (!includeCovariates) {
                    if (!includeTextUnits) {
                      onIncludeTextUnitsChange(true);
                    }
                    onIncludeCovariatesChange(true);
                  } else {
                    onIncludeCovariatesChange(false);
                  }
                }}
                disabled={!hasCovariates || apiSearchResults !== null}
              />
            }
            label="Include Covariates"
          />
        </FormGroup>
      </Box>

      <APISearchDrawer
        apiDrawerOpen={apiDrawerOpen}
        toggleDrawer={toggleApiDrawer}
        handleApiSearch={handleApiSearch}
        apiSearchResults={apiSearchResults}
        localSearchEnabled={localSearchEnabled}
        globalSearchEnabled={includeCommunities}
        hasCovariates={hasCovariates}
        serverUp={serverUp}
      />

      <SearchDrawer
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        handleSearch={handleSearch}
        searchResults={searchResults}
        rightDrawerOpen={rightDrawerOpen}
        toggleDrawer={toggleDrawer}
        handleFocusButtonClick={handleFocusButtonClick}
        handleNodeClick={handleNodeClick}
        handleFocusLinkClick={handleFocusLinkClick}
        handleLinkClick={handleLinkClick}
      />

      <DetailDrawer
        bottomDrawerOpen={bottomDrawerOpen}
        setBottomDrawerOpen={setBottomDrawerOpen}
        selectedNode={selectedNode}
        selectedRelationship={selectedRelationship}
        linkedNodes={linkedNodes}
        linkedRelationships={linkedRelationships}
      />

      {graphType === "2d" ? (
        <ForceGraph2D
          ref={graphRef}
          graphData={filteredGraphData}
          nodeAutoColorBy={undefined}
          nodeRelSize={NODE_R}
          autoPauseRedraw={false}
          linkDirectionalParticles={showHighlight ? PARTICLE_EFFECT.particleCount : 0}
          linkDirectionalParticleWidth={PARTICLE_EFFECT.particleSize}
          linkDirectionalParticleSpeed={PARTICLE_EFFECT.particleSpeed}
          linkDirectionalParticleColor={(link) => {
            if (showHighlight && highlightLinks.has(link)) {
              return theme.palette.mode === 'dark' 
                ? `rgba(255, 255, 255, ${PARTICLE_EFFECT.particleOpacity})`
                : `rgba(0, 0, 0, ${PARTICLE_EFFECT.particleOpacity})`;
            }
            return 'rgba(0,0,0,0)';
          }}
          linkWidth={(link) => {
            if (showHighlight && highlightLinks.has(link)) {
              return 2;
            }
            return theme.palette.mode === 'dark' ? 0.8 : 0.6;
          }}
          linkColor={(link) => {
            if (showHighlight && highlightLinks.has(link)) {
              return theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.6)'
                : 'rgba(0, 0, 0, 0.6)';
            }
            return theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.15)';
          }}
          nodeCanvasObjectMode={() => "before"}
          nodeCanvasObject={(node, ctx) => {
            paintRing(node as CustomNode, ctx);
            if (showLabels && graphZoom >= 0.7) {
              renderNodeLabel(node as CustomNode, ctx);
            }
          }}
          nodeColor={(node: CustomNode) => {
            const nodeType = node.type || 'default';
            return NODE_COLORS[nodeType as keyof typeof NODE_COLORS] || NODE_COLORS.default;
          }}
          onNodeHover={showHighlight ? handleNodeHover : undefined}
          onLinkHover={showHighlight ? handleLinkHover : undefined}
          onNodeClick={handleNodeClick}
          onLinkClick={handleLinkClick}
          backgroundColor={getBackgroundColor()}
          nodeVisibility={(node) => {
            if (graphZoom < 0.5) {
              return node.degree > 2; // Only show important nodes when zoomed out
            }
            return true;
          }}
          linkVisibility={(link) => {
            if (graphZoom < 0.5) {
              return typeof link.source === 'object' && 
                     typeof link.target === 'object' && 
                     ((link.source as CustomNode).degree > 2 || (link.target as CustomNode).degree > 2);
            }
            return true;
          }}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(link, ctx) => {
            if (!showHighlight || !highlightLinks.has(link)) return;

            const getParticlePos = (link: any, startRatio: number) => {
              const pos = new THREE.Vector3();
              const start = link.source;
              const end = link.target;
              
              const t = (startRatio + (Date.now() / 1000) * PARTICLE_EFFECT.particleSpeed) % 1;
              pos.x = start.x + (end.x - start.x) * t;
              pos.y = start.y + (end.y - start.y) * t;
              
              return pos;
            };

            const MAX_PARTICLES = 6;
            // Draw glowing particles
            for (let i = 0; i < MAX_PARTICLES; i++) {
              const pos = getParticlePos(link, i / MAX_PARTICLES);
              
              const gradient = ctx.createRadialGradient(
                pos.x, pos.y, 0,
                pos.x, pos.y, PARTICLE_EFFECT.glowSize
              );
              
              const color = theme.palette.mode === 'dark' ? '255, 255, 255' : '0, 0, 0';
              gradient.addColorStop(0, `rgba(${color}, ${PARTICLE_EFFECT.particleOpacity})`);
              gradient.addColorStop(0.5, `rgba(${color}, ${PARTICLE_EFFECT.particleOpacity * 0.3})`);
              gradient.addColorStop(1, `rgba(${color}, 0)`);
              
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, PARTICLE_EFFECT.glowSize, 0, 2 * Math.PI);
              ctx.fill();
            }
          }}
          d3AlphaDecay={0.02}        // Slower layout stabilization
          d3VelocityDecay={0.3}      // Smoother movement
          warmupTicks={50}           // Reduced initial simulation
          cooldownTicks={1000}       // Longer cooldown for stability
          enableNodeDrag={false}     // Disable drag for smoother experience
          onZoom={debounce((zoom) => {  // Debounced zoom handler
            setGraphZoom(zoom.k);
          }, 100)}
        />
      ) : (
        <ForceGraph3D
          ref={graphRef}
          extraRenderers={extraRenderers}
          graphData={filteredGraphData}
          nodeAutoColorBy={undefined}
          nodeRelSize={NODE_R}
          linkWidth={1.5}
          enableNodeDrag={false}
          enableNavigationControls={true}
          showNavInfo={false}
          nodeThreeObject={(node: CustomNode) => {
            const geometry = new THREE.SphereGeometry(NODE_R, 32, 32);
            const material = new THREE.MeshPhongMaterial({
              color: NODE_COLORS[node.type as keyof typeof NODE_COLORS] || NODE_COLORS.default,
              transparent: true,
              opacity: 0.8,
              shininess: 100
            });
            return new THREE.Mesh(geometry, material);
          }}
          rendererConfig={{
            antialias: true,
            powerPreference: "high-performance",
            alpha: true
          }}
          linkDirectionalParticles={8}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleSpeed={0.02}
          linkDirectionalParticleColor={() => '#ffffff'}
          linkOpacity={0.3}
          linkCurvature={0.25}
        />
      )}
      <Box
        sx={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 1400,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 1,
        }}
      >
        <Typography variant="body2">Nodes: {nodeCount}</Typography>
        <Typography variant="body2">Relationships: {linkCount}</Typography>
        <Button
          variant="contained"
          onClick={toggleApiDrawer(true)}
          startIcon={<SearchIcon />}
        >
          API Search
        </Button>
      </Box>
      {isLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000
          }}
        >
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

export default GraphViewer;
