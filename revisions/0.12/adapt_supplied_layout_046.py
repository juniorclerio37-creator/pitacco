"""Apply the supplied four-screen visual language to real Pitacco components.
No demo data, fake printer status, or local-only payment operations are mounted.
"""
from pathlib import Path
p=Path('web/style.css')
s=p.read_text(encoding='utf-8')
s+="""

/* Layout from pitacco-telas.zip, adapted to live Pitacco workspaces. */
.pitacco-workspace--overview .approved-dashboard{display:flex;flex-direction:column;gap:18px}
.pitacco-workspace--overview .approved-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:6px 0 16px}
.pitacco-workspace--overview .approved-hero h3{font-size:26px;letter-spacing:-.03em;margin:0 0 6px}
.pitacco-workspace--overview .approved-hero p{color:#697586;margin:0}
.pitacco-workspace--overview .approved-actions{display:flex;gap:10px;flex-wrap:wrap}
.pitacco-workspace--overview .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.pitacco-workspace--overview .metrics article{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:19px;min-width:0;box-shadow:0 2px 9px #15233808}
.pitacco-workspace--overview .metrics article span{display:block;color:#657285;font-size:13px;margin-bottom:10px}
.pitacco-workspace--overview .metrics article strong{font-size:clamp(21px,2vw,30px);letter-spacing:-.025em}
.pitacco-workspace--overview .approved-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr);gap:16px;align-items:start}
.pitacco-workspace--overview .approved-grid>.panel{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:20px;margin:0;min-width:0;box-shadow:0 2px 9px #15233808}
.pitacco-workspace--overview .approved-grid>.panel h3{font-size:17px;margin:0 0 15px}
.pitacco-workspace--overview .approved-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pitacco-workspace--overview .approved-shortcuts button{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid #e5eaf1;border-radius:10px;padding:12px;background:#fafbfd}
.pitacco-workspace--overview .approved-table-scroll{overflow-x:auto}
.pitacco-workspace--overview .approved-table-scroll table{width:100%;border-collapse:collapse}
.pitacco-workspace--overview .approved-table-scroll td,.pitacco-workspace--overview .approved-table-scroll th{padding:12px 8px;border-bottom:1px solid #edf0f5;text-align:left}
.pitacco-workspace--overview .approved-finance>div{display:flex;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}
.pitacco-workspace--overview .approved-status{display:flex;flex-direction:column;gap:8px}
.pitacco-workspace--overview .approved-status button{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:1px solid #edf0f5;border-radius:9px;background:#fff}
.pitacco-workspace--overview .approved-status button span{margin-left:auto}
.pitacco-workspace--couriers .panel,.pitacco-workspace--settings .panel{border-radius:14px}
.pitacco-workspace--couriers table,.pitacco-workspace--settings table{width:100%}
.pitacco-workspace--couriers th,.pitacco-workspace--couriers td{padding:11px;border-bottom:1px solid #e9edf3}
@media(max-width:1100px){.pitacco-workspace--overview .approved-grid{grid-template-columns:1fr}.pitacco-workspace--overview .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.pitacco-workspace--overview .metrics{grid-template-columns:1fr 1fr}.pitacco-workspace--overview .approved-shortcuts{grid-template-columns:1fr 1fr}}
"""
p.write_text(s,encoding='utf-8')
