"use client";
import { ... } from "@/data/propositionData";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import { Topology } from "topojson-specification";
import {
  PROPOSITIONS,
  VOTE_DATA,
  CA_COUNTIES,
  type Proposition,
} from "./propositionData";

interface HoveredCounty {
  name: string;
  fips: string;
  pct: number;
}

export default function PropositionMap() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeProp, setActiveProp] = useState<Proposition>(PROPOSITIONS[0]);
  const [hovered, setHovered] = useState<HoveredCounty | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const getColor = (pct: number) => {
    // Red = no (<50), Blue = yes (>50)
    if (pct >= 50) {
      const t = (pct - 50) / 50;
      return d3.interpolateBlues(0.3 + t * 0.65);
    } else {
      const t = (50 - pct) / 50;
      return d3.interpolateReds(0.3 + t * 0.65);
    }
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const W = 340;
    const H = 540;
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%");

    d3.json<Topology>("https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json").then((us) => {
      if (!us) return;

      const allFeatures = (topojson.feature(us, us.objects.counties) as GeoJSON.FeatureCollection).features;
      const caFeatures = allFeatures.filter((d) => {
        const fips = String((d as any).id).padStart(5, "0");
        return fips.startsWith("06");
      });

      const projection = d3.geoMercator().fitSize([W, H], {
        type: "FeatureCollection",
        features: caFeatures,
      });
      const pathGen = d3.geoPath(projection);

      const g = svg.append("g");

      g.selectAll<SVGPathElement, GeoJSON.Feature>("path")
        .data(caFeatures)
        .join("path")
        .attr("d", (d) => pathGen(d) ?? "")
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.6)
        .attr("stroke-linejoin", "round")
        .attr("fill", (d) => {
          const fips = String((d as any).id).padStart(5, "0");
          const pct = VOTE_DATA[activeProp.id]?.[fips];
          return pct !== undefined ? getColor(pct) : "#ccc";
        })
        .style("cursor", "pointer")
        .on("mousemove", function (event, d) {
          const fips = String((d as any).id).padStart(5, "0");
          const name = CA_COUNTIES[fips] ?? "Unknown";
          const pct = VOTE_DATA[activeProp.id]?.[fips];
          if (pct === undefined) return;
          d3.select(this).attr("stroke", "#1a1a2e").attr("stroke-width", 1.5);
          setHovered({ name, fips, pct });
          const svgRect = svgRef.current!.getBoundingClientRect();
          setTooltip({
            x: event.clientX - svgRect.left,
            y: event.clientY - svgRect.top,
          });
        })
        .on("mouseleave", function () {
          d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.6);
          setHovered(null);
          setTooltip(null);
        });

      setLoaded(true);
    });
  }, [activeProp]);

  const prop = activeProp;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <h1 style={styles.title}>California Propositions</h1>
            <p style={styles.subtitle}>2022 General Election · County-level results</p>
          </div>
          <div style={styles.badge(prop.passed)}>
            Statewide: {prop.statewidePct}% yes · {prop.passed ? "Passed ✓" : "Failed ✗"}
          </div>
        </div>
      </header>

      <div style={styles.body}>
        {/* Prop selector */}
        <div style={styles.sidebar}>
          <p style={styles.sidebarLabel}>Select proposition</p>
          {PROPOSITIONS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProp(p)}
              style={styles.propBtn(p.id === prop.id)}
            >
              <span style={styles.propBtnShort(p.id === prop.id)}>{p.shortLabel}</span>
              <span style={styles.propBtnDesc}>{p.desc}</span>
            </button>
          ))}

          {/* Legend */}
          <div style={styles.legendWrap}>
            <p style={styles.sidebarLabel}>% voting yes</p>
            <div style={styles.legendBar} />
            <div style={styles.legendLabels}>
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Hovered county info */}
          <div style={styles.countyCard}>
            {hovered ? (
              <>
                <div style={styles.countyName}>{hovered.name} County</div>
                <div style={styles.countyRow}>
                  <span style={styles.dot(hovered.pct >= 50 ? "#2166ac" : "#d6604d")} />
                  Yes: <strong>{hovered.pct}%</strong>
                </div>
                <div style={styles.countyRow}>
                  <span style={styles.dot("#aaa")} />
                  No: <strong>{100 - hovered.pct}%</strong>
                </div>
                <div style={styles.verdict(hovered.pct >= 50)}>
                  {hovered.pct >= 50 ? "Passed in this county" : "Failed in this county"}
                </div>
              </>
            ) : (
              <div style={{ color: "#999", fontSize: 13 }}>Hover a county to see results</div>
            )}
          </div>
        </div>

        {/* Map */}
        <div style={styles.mapWrap}>
          {!loaded && <div style={styles.loading}>Loading map…</div>}
          <div style={{ position: "relative" }}>
            <svg ref={svgRef} aria-label={`Map of ${prop.label} results by California county`} />
            {tooltip && hovered && (
              <div
                style={{
                  ...styles.tooltip,
                  left: tooltip.x + 14,
                  top: tooltip.y - 10,
                }}
              >
                <strong>{hovered.name}</strong>
                <br />
                Yes: {hovered.pct}% · No: {100 - hovered.pct}%
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const styles = {
  page: {
    fontFamily: "'Georgia', 'Times New Roman', serif",
    background: "#f8f6f1",
    minHeight: "100vh",
    color: "#1a1a2e",
  } as React.CSSProperties,

  header: {
    background: "#1a1a2e",
    color: "#f8f6f1",
    padding: "20px 32px",
  } as React.CSSProperties,

  headerInner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 12,
    maxWidth: 1100,
    margin: "0 auto",
  } as React.CSSProperties,

  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: "-0.02em",
  } as React.CSSProperties,

  subtitle: {
    margin: "4px 0 0",
    fontSize: 13,
    opacity: 0.6,
    fontFamily: "system-ui, sans-serif",
  } as React.CSSProperties,

  badge: (passed: boolean): React.CSSProperties => ({
    background: passed ? "#2166ac22" : "#d6604d22",
    border: `1px solid ${passed ? "#2166ac66" : "#d6604d66"}`,
    color: passed ? "#a8d0f0" : "#f5b09e",
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "system-ui, sans-serif",
    whiteSpace: "nowrap",
  }),

  body: {
    display: "flex",
    gap: 24,
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 32px",
    alignItems: "flex-start",
  } as React.CSSProperties,

  sidebar: {
    width: 240,
    flexShrink: 0,
  } as React.CSSProperties,

  sidebarLabel: {
    margin: "0 0 8px",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#888",
    fontFamily: "system-ui, sans-serif",
  },

  propBtn: (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    marginBottom: 6,
    background: active ? "#1a1a2e" : "#fff",
    border: `1px solid ${active ? "#1a1a2e" : "#e2ddd5"}`,
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.15s",
    color: active ? "#f8f6f1" : "#1a1a2e",
  }),

  propBtnShort: (active: boolean): React.CSSProperties => ({
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "system-ui, sans-serif",
    marginBottom: 2,
    color: active ? "#f8f6f1" : "#1a1a2e",
  }),

  propBtnDesc: {
    display: "block",
    fontSize: 11,
    opacity: 0.65,
    fontFamily: "system-ui, sans-serif",
    lineHeight: 1.4,
  } as React.CSSProperties,

  legendWrap: {
    marginTop: 24,
  } as React.CSSProperties,

  legendBar: {
    height: 10,
    borderRadius: 5,
    background: "linear-gradient(to right, #d6604d, #f7f7f7, #2166ac)",
    marginBottom: 4,
  } as React.CSSProperties,

  legendLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "#888",
    fontFamily: "system-ui, sans-serif",
  } as React.CSSProperties,

  countyCard: {
    marginTop: 16,
    padding: "12px 14px",
    background: "#fff",
    border: "1px solid #e2ddd5",
    borderRadius: 8,
    minHeight: 80,
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  } as React.CSSProperties,

  countyName: {
    fontWeight: 600,
    marginBottom: 6,
    fontSize: 14,
  } as React.CSSProperties,

  countyRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
    fontSize: 13,
  } as React.CSSProperties,

  dot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    display: "inline-block",
    flexShrink: 0,
  }),

  verdict: (passed: boolean): React.CSSProperties => ({
    marginTop: 6,
    fontSize: 11,
    color: passed ? "#2166ac" : "#d6604d",
    fontWeight: 500,
  }),

  mapWrap: {
    flex: 1,
    position: "relative",
    minHeight: 400,
  } as React.CSSProperties,

  loading: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#999",
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
  } as React.CSSProperties,

  tooltip: {
    position: "absolute",
    background: "#1a1a2e",
    color: "#f8f6f1",
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "system-ui, sans-serif",
    pointerEvents: "none",
    whiteSpace: "nowrap",
    zIndex: 10,
  } as React.CSSProperties,
};
