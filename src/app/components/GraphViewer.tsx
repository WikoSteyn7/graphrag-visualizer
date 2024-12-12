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
  particleSize: 2,
  particleSpeed: 0.2,
  particleCount: 6,
  particleOpacity: 0.8,
  trailLength: 0.3,
  glowSize: 4
};

const ANIMATION_CONFIG = {
  amplitude: 0.3,      // Subtle movement
  frequency: 0.0003,   // Very slow frequency for smooth motion
  phaseShift: 0.5,     // Phase shift for variation
  centerPull: 0.02     // Gentle center pull
};

const createOscillation = (time: number, seed: number) => {
  const t = time * ANIMATION_CONFIG.frequency;
  const phase = seed * ANIMATION_CONFIG.phaseShift;
  return Math.sin(t + phase) * ANIMATION_CONFIG.amplitude;
};

const NODE_COLORS = {
  ORGANIZATION: {
    primary: '#FFB74D',    // Warm orange-gold
    secondary: '#FF9800',  // Deep orange
    highlight: '#FFA726',  // Bright orange
    glow: '#FFF3E0'       // Light warm glow
  },
  EVENT: {
    primary: '#4FC3F7',    // Bright blue
    secondary: '#0288D1',  // Deep blue
    highlight: '#29B6F6',  // Electric blue
    glow: '#E1F5FE'       // Light blue glow
  },
  GEO: {
    primary: '#81C784',    // Fresh green
    secondary: '#388E3C',  // Forest green
    highlight: '#66BB6A',  // Vibrant green
    glow: '#E8F5E9'       // Light green glow
  },
  PERSON: {
    primary: '#E57373',    // Coral red
    secondary: '#D32F2F',  // Deep red
    highlight: '#EF5350',  // Bright red
    glow: '#FFEBEE'       // Light red glow
  },
  default: {
    primary: '#B39DDB',    // Soft purple
    secondary: '#673AB7',  // Deep purple
    highlight: '#9575CD',  // Medium purple
    glow: '#EDE7F6'       // Light purple glow
  }
};

const ANIMATION_3D = {
  rotationSpeed: 0.001,
  pulseFrequency: 0.5,
  glowIntensity: 1.2,
  particleSpeed: 0.02,
  cameraDistance: 300,
  autoRotate: true
};

const CLOUD_EFFECT = {
  radius: NODE_R * 4,           // Increased radius
  color: 'rgba(103, 58, 183, ', // Pure color without alpha
  blur: 20,                     // Increased blur
  pulseSpeed: 0.0005,          // Slower pulse
  minOpacity: 0.1,             // Minimum opacity
  maxOpacity: 0.3              // Maximum opacity
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

  const [animationStartTime, setAnimationStartTime] = useState(Date.now());

  const resetAnimation = useCallback(() => {
    setAnimationStartTime(Date.now());
  }, []);

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
    let animationFrameId: number;
    const animate = () => {
      if (graphRef.current && graphType === "2d") {
        const nodes = graphRef.current._graphData?.nodes;
        if (!nodes) return;
        
        const time = Date.now() - animationStartTime;
        
        nodes.forEach((node: CustomNode) => {
          if (!node.x || !node.y || node.isDragging) return;
          
          if (!node.__baseX) node.__baseX = node.x;
          if (!node.__baseY) node.__baseY = node.y;
          
          const seed = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          
          const xOscillation = Math.sin(time * 0.0005 + seed) * 0.2;
          const yOscillation = Math.cos(time * 0.0005 + seed) * 0.2;
          
          node.x = node.__baseX + xOscillation;
          node.y = node.__baseY + yOscillation;
        });
        
        graphRef.current.refresh();
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [graphType, animationStartTime]);

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
      // Create a serializable version of the data
      const serializableData = {
        nodes: data.nodes.map((node: CustomNode) => ({
          id: node.id,
          uuid: node.uuid,
          name: node.name,
          type: node.type,
          x: node.x,
          y: node.y
        })),
        links: data.links.map((link: CustomLink) => ({
          source: typeof link.source === 'object' ? (link.source as CustomNode).id : link.source,
          target: typeof link.target === 'object' ? (link.target as CustomNode).id : link.target,
          type: link.type
        }))
      };

      const worker = new Worker(`${process.env.PUBLIC_URL}/forceWorker.ts`);
      worker.postMessage(serializableData);
      worker.onmessage = (event) => {
        const updatedData = {
          ...data,
          nodes: data.nodes.map((node: CustomNode) => ({
            ...node,
            x: (event.data.nodes as Array<{ id: string; x: number; y: number }>).find(n => n.id === node.id)?.x || node.x,
            y: (event.data.nodes as Array<{ id: string; x: number; y: number }>).find(n => n.id === node.id)?.y || node.y
          }))
        };
        setGraphData(updatedData);
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

      // Draw cloud effect for groups of nodes
      const nearbyNodes = graphRef.current?._graphData?.nodes?.filter((n: CustomNode) => {
        if (n === node || !n.x || !n.y) return false;
        const dx = n.x - x;
        const dy = n.y - y;
        return Math.sqrt(dx * dx + dy * dy) < CLOUD_EFFECT.radius;
      }) || [];

      if (nearbyNodes.length > 1) { // Changed threshold to 1
        ctx.save();
        ctx.beginPath();
        
        // Create cloud path
        const time = Date.now() * CLOUD_EFFECT.pulseSpeed;
        const cloudRadius = CLOUD_EFFECT.radius * (1 + Math.sin(time) * 0.1);
        
        // Calculate opacity based on number of nearby nodes
        const opacity = Math.min(
          CLOUD_EFFECT.minOpacity + (nearbyNodes.length * 0.05),
          CLOUD_EFFECT.maxOpacity
        );
        
        ctx.filter = `blur(${CLOUD_EFFECT.blur}px)`;
        ctx.fillStyle = CLOUD_EFFECT.color + opacity + ')';
        
        // Draw multiple overlapping circles for denser effect
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x, y, cloudRadius * (0.8 + i * 0.2), 0, 2 * Math.PI);
          ctx.fill();
        }
        
        ctx.filter = 'none';
        ctx.restore();
      }

      const nodeType = node.type || 'default';
      const colors = NODE_COLORS[nodeType as keyof typeof NODE_COLORS] || NODE_COLORS.default;
      const isHighlighted = highlightNodes.has(node);
      const isDark = theme.palette.mode === 'dark';

      ctx.save();
      
      const radius = NODE_R;
      
      // Outer glow
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = isHighlighted ? 20 : 15;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Base layer with frosted effect
      const baseGradient = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.3,
        0,
        x,
        y,
        radius * 1.2
      );

      if (isHighlighted) {
        baseGradient.addColorStop(0, `${colors.highlight}FF`);
        baseGradient.addColorStop(0.5, `${colors.primary}EE`);
        baseGradient.addColorStop(1, `${colors.secondary}DD`);
      } else {
        baseGradient.addColorStop(0, `${colors.primary}${isDark ? 'DD' : 'FF'}`);
        baseGradient.addColorStop(0.7, `${colors.secondary}${isDark ? 'BB' : 'DD'}`);
        baseGradient.addColorStop(1, `${colors.secondary}${isDark ? '99' : 'BB'}`);
      }

      // Draw base
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = baseGradient;
      ctx.fill();

      // Frosted glass overlay
      const frostGradient = ctx.createLinearGradient(
        x - radius,
        y - radius,
        x + radius,
        y + radius
      );
      
      if (isDark) {
        frostGradient.addColorStop(0, 'rgba(255,255,255,0.15)');
        frostGradient.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        frostGradient.addColorStop(1, 'rgba(255,255,255,0.02)');
      } else {
        frostGradient.addColorStop(0, 'rgba(255,255,255,0.5)');
        frostGradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
        frostGradient.addColorStop(1, 'rgba(255,255,255,0.1)');
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = frostGradient;
      ctx.fill();

      // Top highlight for 3D effect
      const highlightGradient = ctx.createRadialGradient(
        x - radius * 0.5,
        y - radius * 0.5,
        radius * 0.1,
        x - radius * 0.3,
        y - radius * 0.3,
        radius * 0.8
      );
      
      highlightGradient.addColorStop(0, 'rgba(255,255,255,0.4)');
      highlightGradient.addColorStop(0.5, 'rgba(255,255,255,0.1)');
      highlightGradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      ctx.restore();
    },
    [highlightNodes, theme.palette.mode, graphRef]
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
      return new THREE.Mesh(geometry, material);
    }

    const nodeEl = document.createElement("div");
    nodeEl.textContent = node.name || node.id;
    nodeEl.style.color = '#ffffff';
    nodeEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    nodeEl.style.padding = "2px 6px";
    nodeEl.style.borderRadius = "4px";
    nodeEl.style.fontSize = "12px";
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

  const handleZoom = useCallback((zoom: any) => {
    setGraphZoom(zoom.k);
    setAnimationStartTime(Date.now()); // Restart animation on zoom
  }, []);

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
            return theme.palette.mode === 'dark' ? 0.6 : 0.4;
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
            return NODE_COLORS[nodeType as keyof typeof NODE_COLORS].primary;
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
          enableNodeDrag={true}     // Disable drag for smoother experience
          onZoom={handleZoom}
          onNodeDrag={(node, translate) => {
            node.isDragging = true;
            node.fx = node.x;
            node.fy = node.y;
            node.__baseX = node.x;
            node.__baseY = node.y;
          }}
          onNodeDragEnd={(node) => {
            node.isDragging = false;
            node.fx = undefined;
            node.fy = undefined;
            node.__baseX = node.x;
            node.__baseY = node.y;
            resetAnimation(); // Reset animation when drag ends
          }}
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
            const nodeType = node.type || 'default';
            const geometry = new THREE.SphereGeometry(NODE_R, 32, 32);
            const material = new THREE.MeshPhongMaterial({
              color: NODE_COLORS[nodeType as keyof typeof NODE_COLORS].primary,
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
          linkDirectionalParticleWidth={2}
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
