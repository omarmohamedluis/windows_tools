// Marcadores→Frases_porCapa_precompUpdate_reset03.jsx
// Panel: asigna pares de marcadores de una capa de referencia a capas seleccionadas.
// - Botón "Actualizar marcadores desde precomp" (menú de AE, con fallback 2539)
// - Reutiliza el ÚLTIMO par si faltan (repeat last)
// - NUEVO: "Resetear tiempos (0s/3s)" en las capas seleccionadas
// Compatible ExtendScript (AE 2024/2025). Sin let/const ni nombres reservadas.

(function (thisObj) {

    // ---------- Utils ----------
    function err(m){ throw new Error(m); }
    function isComp(x){ return x && x instanceof CompItem; }
    function tr(layer){ return layer && layer.property("ADBE Transform Group"); }
    function p(layer){ var t=tr(layer); return t ? t.property("ADBE Position") : null; }
    function px(layer){ var t=tr(layer); return t ? t.property("ADBE Position_0") : null; }
    function py(layer){ var t=tr(layer); return t ? t.property("ADBE Position_1") : null; }
    function has2(prop){ return prop && prop.canVaryOverTime && prop.numKeys >= 2; }

    function firstTwoTimes(prop){
        // Devuelve tiempos del 1º y del 2º key con tiempos distintos
        var n = prop.numKeys;
        var t1 = prop.keyTime(1);
        var t2 = null;
        var i;
        for (i=2; i<=n; i++){
            var ti = prop.keyTime(i);
            if (ti !== t1){ t2 = ti; break; }
        }
        return { t1: t1, t2: t2 };
    }

    function firstLast(prop){
        var n = prop.numKeys;
        return { t1: prop.keyTime(1), tN: prop.keyTime(n) };
    }

    function collect(prop){
        var n = prop.numKeys, a = [];
        var k;
        for (k=1; k<=n; k++){
            a.push({
                t: prop.keyTime(k),
                v: prop.keyValue(k),
                inI: prop.keyInInterpolationType(k),
                outI: prop.keyOutInterpolationType(k),
                inE: prop.keyInTemporalEase(k),
                outE: prop.keyOutTemporalEase(k)
            });
        }
        return a;
    }

    function clear(prop){
        var i;
        for (i=prop.numKeys; i>=1; i--) prop.removeKey(i);
    }

    function reapplyScaled(prop, keys, srcStart, srcEnd, dstStart, dstEnd){
        var srcDur = srcEnd - srcStart;
        var dstDur = dstEnd - dstStart;
        if (srcDur <= 0 || dstDur < 0) err("Rangos inválidos.");
        var scale = (srcDur === 0) ? 1 : (dstDur / srcDur);
        var i;
        for (i=0; i<keys.length; i++){
            var k = keys[i];
            var rel = k.t - srcStart;
            var newT = dstStart + rel * scale;
            var idx = prop.addKey(newT);
            prop.setValueAtKey(idx, k.v);
            if (k.inI && k.outI) prop.setInterpolationTypeAtKey(idx, k.inI, k.outI);
            if (k.inE && k.outE) prop.setTemporalEaseAtKey(idx, k.inE, k.outE);
        }
    }

    // ---------- Markers (leer pares de la capa ref) ----------
    function getLayerMarkersPairs(layer){
        var m = layer && layer.marker;
        if (!m || m.numKeys < 2) err("La capa de referencia necesita al menos 2 marcadores.");
        var items = [];
        var i;
        for (i=1; i<=m.numKeys; i++) items.push({t: m.keyTime(i)});
        items.sort(function(a,b){ return a.t - b.t; });

        var pairs = [];
        for (i=0; i+1<items.length; i+=2){
            var a = items[i], b = items[i+1];
            var t1 = Math.min(a.t, b.t), t2 = Math.max(a.t, b.t);
            pairs.push({ tIn: t1, tOut: t2 });
        }
        return pairs;
    }

    // ---------- Update Markers From Source (menú de AE) ----------
    function updateMarkersFromPrecompViaMenu(refLayer, log){
        if (!(refLayer && refLayer.source && refLayer.source instanceof CompItem))
            err("La capa seleccionada no es una precomp.");

        var cmdId = app.findMenuCommandId("Update Markers from Source (replaces all markers)");
        if (cmdId <= 0) cmdId = app.findMenuCommandId("Update Markers from Source");
        if (cmdId <= 0) cmdId = 2539; // fallback

        if (cmdId <= 0) err("No pude localizar el comando 'Update Markers from Source'.");

        var comp = refLayer.containingComp || app.project.activeItem;
        if (!isComp(comp)) err("No hay comp activa.");

        // Guardar/restaurar selección
        var prev = [];
        var i;
        for (i=1; i<=comp.numLayers; i++){
            var ly = comp.layer(i);
            if (ly.selected) prev.push(i);
            ly.selected = false;
        }
        refLayer.selected = true;

        app.executeCommand(cmdId);

        refLayer.selected = false;
        for (i=0; i<prev.length; i++){
            var back = comp.layer(prev[i]);
            if (back) back.selected = true;
        }

        log("Marcadores actualizados desde precomp (cmd " + cmdId + ").\n");
    }

    // ---------- Core: aplicar pares a capas (repeat last) ----------
    function applyMappingFromLayer(refLayer, layers, excludeRef, log){
        var pairs = getLayerMarkersPairs(refLayer);
        if (pairs.length === 0) err("No hay pares suficientes de marcadores.");

        var targets = [];
        var i;
        for (i=0; i<layers.length; i++){
            if (excludeRef && layers[i] === refLayer) continue;
            targets.push(layers[i]);
        }
        if (targets.length === 0) err("No hay capas destino válidas.");

        var changed = 0, skippedLayers = 0;

        for (i=0; i<targets.length; i++){
            var ly = targets[i];
            var rng = pairs[Math.min(i, pairs.length - 1)]; // reutiliza el último par

            if (rng.tIn === rng.tOut){
                log("• Ventana vacía, salto capa " + ly.name + "\n");
                continue;
            }

            var pos = p(ly);
            var did = false;

            if (pos && pos.dimensionsSeparated !== true && has2(pos)){
                var keys = collect(pos);
                var tl = firstLast(pos);
                clear(pos);
                reapplyScaled(pos, keys, tl.t1, tl.tN, rng.tIn, rng.tOut);
                did = true;
            } else {
                var posX = px(ly), posY = py(ly);
                var didX = false, didY = false;

                if (has2(posX)){
                    var kx = collect(posX);
                    var tlx = firstLast(posX);
                    clear(posX);
                    reapplyScaled(posX, kx, tlx.t1, tlx.tN, rng.tIn, rng.tOut);
                    didX = true;
                }
                if (has2(posY)){
                    var ky = collect(posY);
                    var tly = firstLast(posY);
                    clear(posY);
                    reapplyScaled(posY, ky, tly.t1, tly.tN, rng.tIn, rng.tOut);
                    didY = true;
                }
                did = (didX || didY);
            }

            if (did){
                changed++;
                log("✔ " + ly.index + " · " + ly.name + " → [" + rng.tIn.toFixed(3) + "–" + rng.tOut.toFixed(3) + "]\n");
            } else {
                skippedLayers++;
                log("• " + ly.index + " · " + ly.name + " (sin suficientes keys en Position/X/Y)\n");
            }
        }

        if (targets.length > pairs.length){
            log("ℹ Faltaban pares: se reutilizó el último para " + (targets.length - pairs.length) + " capa(s).\n");
        }

        log("\nResumen → Ajustadas: " + changed + " | Omitidas: " + skippedLayers + "\n");
    }

    // ---------- NUEVO: Resetear tiempos 0s/3s ----------
    function resetTimes_0_3_forSelectedLayers(log){
        var comp = app.project.activeItem;
        if (!isComp(comp)) err("Abre una comp activa.");
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) err("Selecciona capas para resetear tiempos.");

        var changed = 0, skipped = 0;
        var i;

        function normalizeProp(prop){
            if (!has2(prop)) return false;
            var two = firstTwoTimes(prop);
            if (two.t2 === null || two.t2 === two.t1) return false;

            var keys = collect(prop);
            clear(prop);

            var srcStart = two.t1;
            var srcSecond = two.t2;
            var dstStart = 0.0;
            var dstSecond = 3.0;
            var scale = (srcSecond - srcStart) === 0 ? 1 : (dstSecond - dstStart) / (srcSecond - srcStart);

            var j;
            for (j=0; j<keys.length; j++){
                var k = keys[j];
                var rel = k.t - srcStart;
                var newT = dstStart + rel * scale; // t1->0, t2->3, los demás se recolocan proporcionalmente
                var idx = prop.addKey(newT);
                prop.setValueAtKey(idx, k.v);
                if (k.inI && k.outI) prop.setInterpolationTypeAtKey(idx, k.inI, k.outI);
                if (k.inE && k.outE) prop.setTemporalEaseAtKey(idx, k.inE, k.outE);
            }
            return true;
        }

        for (i=0; i<sel.length; i++){
            var ly = sel[i];
            var did = false;

            var pos = p(ly);
            if (pos && pos.dimensionsSeparated !== true){
                did = normalizeProp(pos);
            } else {
                var posX = px(ly);
                var posY = py(ly);
                var dx = false, dy = false;
                if (posX) dx = normalizeProp(posX);
                if (posY) dy = normalizeProp(posY);
                did = (dx || dy);
            }

            if (did){ changed++; log("✔ Reset 0/3s → " + ly.index + " · " + ly.name + "\n"); }
            else { skipped++; log("• " + ly.index + " · " + ly.name + " (necesita ≥2 keys con tiempos distintos)\n"); }
        }

        log("\nReset tiempos → Hechas: " + changed + " | Omitidas: " + skipped + "\n");
    }

    // ---------- UI ----------
    function buildUI(thisObj){
        var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Marcadores→Frases (por capa)", undefined, {resizeable:true});
        var g = win.add("group"); g.orientation = "column"; g.alignChildren = "fill";

        var rowRef = g.add("group"); rowRef.orientation = "row";
        rowRef.add("statictext", undefined, "Capa de referencia:");
        var ddRef = rowRef.add("dropdownlist", undefined, []);
        ddRef.minimumSize.width = 300;

        var cbExclude = g.add("checkbox", undefined, "Excluir capa de referencia si está seleccionada"); cbExclude.value = true;

        var btnUpdateMarkers = g.add("button", undefined, "Actualizar marcadores desde precomp"); btnUpdateMarkers.enabled = false;

        var btnApply = g.add("button", undefined, "Aplicar a capas seleccionadas");

        // NUEVO botón: reset tiempos 0/3
        var btnReset03 = g.add("button", undefined, "Resetear tiempos (0s/3s)");

        var logEdit = g.add("edittext", undefined, "", {multiline:true, scrolling:true});
        logEdit.preferredSize = [500, 260];
        function log(s){ try{ logEdit.text += s; logEdit.active = true; }catch(e){} }

        function populateRefDropdown(){
            ddRef.removeAll();
            var comp = app.project.activeItem;
            if (!isComp(comp)) return;
            var i;
            for (i=1; i<=comp.numLayers; i++){
                var ly = comp.layer(i);
                ddRef.add("item", "#" + i + " · " + ly.name);
            }
            if (comp.numLayers > 0) ddRef.selection = 0;
            checkPrecomp();
        }

        function checkPrecomp(){
            var comp = app.project.activeItem;
            if (!isComp(comp) || !ddRef.selection){ btnUpdateMarkers.enabled=false; return; }
            var refIdx = ddRef.selection.index + 1;
            var refLayer = comp.layer(refIdx);
            btnUpdateMarkers.enabled = !!(refLayer && refLayer.source && (refLayer.source instanceof CompItem));
        }

        ddRef.onChange = checkPrecomp;

        btnUpdateMarkers.onClick = function(){
            app.beginUndoGroup("Actualizar marcadores desde precomp");
            logEdit.text = "";
            try{
                var comp = app.project.activeItem;
                if (!isComp(comp)) err("Abre la comp donde está la capa de referencia.");
                if (!ddRef.selection) err("Selecciona una capa de referencia.");
                var refIdx = ddRef.selection.index + 1;
                var refLayer = comp.layer(refIdx);
                updateMarkersFromPrecompViaMenu(refLayer, log);
            } catch(e){
                log("Error: " + e.message + "\n");
            } finally {
                app.endUndoGroup();
            }
        };

        btnApply.onClick = function(){
            app.beginUndoGroup("Marcadores→Frases (por capa)");
            logEdit.text = "";
            try{
                var comp = app.project.activeItem;
                if (!isComp(comp)) err("Abre la comp donde están las frases.");
                if (!ddRef.selection) err("Selecciona una capa de referencia.");
                var refIdx = ddRef.selection.index + 1;
                var refLayer = comp.layer(refIdx);
                var sel = comp.selectedLayers;
                if (!sel || sel.length === 0) err("Selecciona las capas (frases) en orden.");
                applyMappingFromLayer(refLayer, sel, cbExclude.value, log);
            } catch(e){
                log("Error: " + e.message + "\n");
            } finally {
                app.endUndoGroup();
            }
        };

        btnReset03.onClick = function(){
            app.beginUndoGroup("Reset tiempos 0s/3s");
            logEdit.text = "";
            try{
                resetTimes_0_3_forSelectedLayers(log);
            } catch(e){
                log("Error: " + e.message + "\n");
            } finally {
                app.endUndoGroup();
            }
        };

        populateRefDropdown();
        win.onResizing = win.onResize = function(){ win.layout.resize(); };
        return win;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) ui.center(), ui.show();

})(this);
