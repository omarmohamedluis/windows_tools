// AsignarMarcadores_porSeleccion_RefLayerActivo_SYNC.jsx
// - Fuente SIEMPRE: marcadores de una CAPA de la comp activa (elegida en el UI).
// - Botón: "Actualizar marcadores desde origen" copia los marcadores de COMPOSICIÓN
//          de la precomp origen (si la capa lo es) a la capa de referencia.
//          Compatible con AE que usa comp.markerProperty (en vez de comp.marker)
//          y mapea tiempos con sourceTimeToCompTime() (soporta stretch y time-remap).
// - Par 1 = (M1–M2) → 1ª capa seleccionada; Par 2 = (M3–M4) → 2ª, etc.

(function(){
    // ---------- UI ----------
    function listLayersSummary(comp){
        var arr = [];
        for (var i=1; i<=comp.numLayers; i++){
            var ly = comp.layer(i);
            var count = (ly.marker) ? ly.marker.numKeys : 0;
            var label = ly.index + " · " + ly.name + "  [" + count + " marcadores]";
            arr.push({layer: ly, label: label, count: count});
        }
        // Mostrar arriba las que tienen marcadores
        arr.sort(function(a,b){ return b.count - a.count || a.layer.index - b.layer.index; });
        return arr;
    }

    function buildUI(comp){
        var win = new Window("dialog", "Asignar marcadores (ref: capa en comp activa)");
        win.alignChildren = "fill";

        var gProp = win.add("group");
        gProp.add("statictext", undefined, "Propiedad de Transformar:");
        var ddProp = gProp.add("dropdownlist", undefined, [
            "Punto de ancla",
            "Posición",
            "Escala",
            "Rotación",
            "Opacidad"
        ]);
        ddProp.selection = 1; // Posición

        var gRef = win.add("group");
        gRef.add("statictext", undefined, "Capa de referencia (marcadores):");
        var ddRef = gRef.add("dropdownlist", undefined, []);
        ddRef.minimumSize.width = 360;

        // Botón para sincronizar marcadores desde el origen (si es precomp)
        var gSync = win.add("group");
        var btnSync = gSync.add("button", undefined, "⬆ Actualizar marcadores desde origen");

        var info = win.add("statictext", undefined,
            "Par 1=(M1–M2) → 1ª capa seleccionada; Par 2=(M3–M4) → 2ª, etc.\n" +
            "Usa una capa (Null/Sólida o Precomp) como referencia y pon/copia ahí los marcadores.",
            {multiline:true}
        );
        info.maximumSize.width = 460;

        var gBtns = win.add("group"); gBtns.alignment = "right";
        var btnCancel = gBtns.add("button", undefined, "Cancelar");
        var btnOK = gBtns.add("button", undefined, "Aplicar", {name:"ok"});

        // Poblar capas
        var entries = listLayersSummary(comp);
        if (entries.length === 0){ alert("La comp activa no tiene capas."); return null; }
        for (var i=0; i<entries.length; i++) ddRef.add("item", entries[i].label);
        ddRef.selection = 0;

        // Acción del botón de sincronizar
        btnSync.onClick = function(){
            var refLayer = entries[ddRef.selection.index].layer;
            var synced = syncMarkersFromSourceIfPrecomp(refLayer);
            if (synced){
                // Actualizar etiqueta con nuevo recuento
                var newCount = (refLayer.marker) ? refLayer.marker.numKeys : 0;
                ddRef.items[ddRef.selection.index].text =
                    refLayer.index + " · " + refLayer.name + "  [" + newCount + " marcadores]";
                alert("Marcadores actualizados desde el origen.");
            }
        };

        btnCancel.onClick = function(){ win.close(0); };
        btnOK.onClick = function(){ win.close(1); };

        return {
            win: win,
            ddProp: ddProp,
            ddRef: ddRef,
            getRefLayer: function(){ return entries[ddRef.selection.index].layer; }
        };
    }

    // ---------- Helpers ----------
    function getTransformProp(layer, choice){
        var t = layer.property("ADBE Transform Group"); if (!t) return null;
        var map = {
            "Punto de ancla": "ADBE Anchor Point",
            "Posición":       "ADBE Position",
            "Escala":         "ADBE Scale",
            "Rotación":       "ADBE Rotate Z",
            "Opacidad":       "ADBE Opacity"
        };
        var p = t.property(map[choice]);
        if (!p && choice === "Rotación") p = t.property("ADBE Orientation");
        return p || null;
    }

    // Devuelve el MarkerProperty correcto de una comp para todas las versiones (marker / markerProperty)
    function getCompMarkerProperty(compItem){
        if (!compItem) return null;
        if (compItem.marker) return compItem.marker;                 // algunas versiones
        if (compItem.markerProperty) return compItem.markerProperty; // otras versiones
        try { return compItem["markerProperty"]; } catch(e){}
        try { return compItem["marker"]; } catch(e){}
        return null;
    }

    // Copia marcadores de COMPOSICIÓN del source (si la capa es precomp) a marcadores de la CAPA.
    // Mapea tiempos con sourceTimeToCompTime() (soporta stretch y time-remap).
    function syncMarkersFromSourceIfPrecomp(refLayer){
        try{
            if (!refLayer || !refLayer.source || !(refLayer.source instanceof CompItem)){
                alert("La capa seleccionada no es una precomp (no tiene comp de origen).");
                return false;
            }
            var srcComp = refLayer.source;
            var mk = getCompMarkerProperty(srcComp);
            if (!mk || mk.numKeys < 1){
                alert("La comp de origen '"+srcComp.name+"' no tiene marcadores de composición.");
                return false;
            }

            var go = confirm("Esto reemplazará los marcadores de la capa '"+refLayer.name+
                             "' con los de la comp origen '"+srcComp.name+"'. ¿Continuar?");
            if (!go) return false;

            var lm = refLayer.marker;
            // Borrar marcadores actuales
            for (var i=lm.numKeys; i>=1; i--) lm.removeKey(i);

            for (var k=1; k<=mk.numKeys; k++){
                var tSrc = mk.keyTime(k);
                var mv = mk.keyValue(k); // MarkerValue
                var nv = new MarkerValue(mv.comment);
                try { nv.duration = mv.duration; } catch(e){}
                try { nv.chapter = mv.chapter; } catch(e){}
                try { nv.url = mv.url; } catch(e){}
                try { nv.frameTarget = mv.frameTarget; } catch(e){}
                try { nv.eventCuePoint = mv.eventCuePoint; } catch(e){}
                try { nv.cuePointName = mv.cuePointName; } catch(e){}
                try { nv.parameters = mv.parameters; } catch(e){}
                try { nv.protectedRegion = mv.protectedRegion; } catch(e){}

                // Mapear a tiempo de la comp activa (tiene en cuenta stretch y time-remap)
                var tParent;
                try { tParent = refLayer.sourceTimeToCompTime(tSrc); }
                catch(e){ tParent = refLayer.startTime + tSrc * (refLayer.stretch / 100.0); }

                lm.setValueAtTime(tParent, nv);
            }
            return true;
        } catch(err){
            alert("No se pudo actualizar desde origen:\n" + err);
            return false;
        }
    }

    function getMarkerPairsFromLayer(refLayer){
        if (!refLayer.marker || refLayer.marker.numKeys < 2)
            throw "La capa de referencia necesita al menos 2 marcadores.";

        var times = [];
        for (var k=1; k<=refLayer.marker.numKeys; k++){
            times.push(refLayer.marker.keyTime(k));
        }

        // Ordenar y deduplicar exactos
        times.sort(function(a,b){ return a-b; });
        var unique = [];
        for (var i=0; i<times.length; i++){
            if (i===0 || times[i] !== times[i-1]) unique.push(times[i]);
        }
        if (unique.length < 2) throw "No hay suficientes marcadores válidos (mínimo 2).";

        // Emparejar consecutivos (1–2, 3–4, ...)
        var pairs = [];
        for (var j=0; j+1<unique.length; j+=2){
            var a = unique[j], b = unique[j+1];
            if (a === b) continue;
            pairs.push({IN: Math.min(a,b), OUT: Math.max(a,b)});
        }
        if (pairs.length === 0) throw "No se pudieron formar pares de marcadores (1–2, 3–4, ...).";
        return pairs;
    }

    function remapKeysToRange(prop, tStart, tEnd){
        if (!(prop instanceof Property) || !prop.isTimeVarying || prop.numKeys < 2) return false;

        var kNum = prop.numKeys;
        var t1 = prop.keyTime(1), tN = prop.keyTime(kNum);
        if (t1 === tN) return false;

        var srcDur = tN - t1, dstDur = tEnd - tStart;

        var times = [], values = [];
        var inInterp = [], outInterp = [];
        var easeIn = [], easeOut = [];
        var roving = [];
        var spatIn = [], spatOut = [];
        var temporalAuto = [], temporalCont = [];
        var spatialAuto = [], spatialCont = [];

        for (var k=1; k<=kNum; k++){
            times.push(prop.keyTime(k));
            values.push(prop.keyValue(k));
            inInterp.push(prop.keyInInterpolationType(k));
            outInterp.push(prop.keyOutInterpolationType(k));
            easeIn.push(prop.keyInTemporalEase(k));
            easeOut.push(prop.keyOutTemporalEase(k));
            try { roving.push(prop.keyRoving(k)); } catch(e){ roving.push(false); }
            try { spatIn.push(prop.keyInSpatialTangent(k)); } catch(e){ spatIn.push(null); }
            try { spatOut.push(prop.keyOutSpatialTangent(k)); } catch(e){ spatOut.push(null); }
            try { temporalAuto.push(prop.keyTemporalAutoBezier(k)); } catch(e){ temporalAuto.push(false); }
            try { temporalCont.push(prop.keyTemporalContinuous(k)); } catch(e){ temporalCont.push(false); }
            try { spatialAuto.push(prop.keySpatialAutoBezier(k)); } catch(e){ spatialAuto.push(false); }
            try { spatialCont.push(prop.keySpatialContinuous(k)); } catch(e){ spatialCont.push(false); }
        }

        var newTimes = [];
        for (var j=0; j<kNum; j++){
            var s = (times[j] - t1) / srcDur;
            newTimes.push(tStart + s * dstDur);
        }

        for (var r=kNum; r>=1; r--) prop.removeKey(r);

        for (var n=0; n<kNum; n++){
            var idx = prop.addKey(newTimes[n]);
            try { prop.setValueAtKey(idx, values[n]); } catch(e){}
            try { prop.setInterpolationTypeAtKey(idx, inInterp[n], outInterp[n]); } catch(e){}
            try { prop.setTemporalEaseAtKey(idx, easeIn[n], easeOut[n]); } catch(e){}
            try { prop.setRovingAtKey(idx, roving[n]); } catch(e){}
            if (spatIn[n] && spatOut[n]){
                try { prop.setSpatialTangentsAtKey(idx, spatIn[n], spatOut[n]); } catch(e){}
            }
            try { prop.setTemporalAutoBezierAtKey(idx, temporalAuto[n]); } catch(e){}
            try { prop.setTemporalContinuousAtKey(idx, temporalCont[n]); } catch(e){}
            try { prop.setSpatialAutoBezierAtKey(idx, spatialAuto[n]); } catch(e){}
            try { prop.setSpatialContinuousAtKey(idx, spatialCont[n]); } catch(e){}
        }
        return true;
    }

    // ---------- MAIN ----------
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)){ alert("Abre una composición activa."); return; }

    var ui = buildUI(comp);
    if (!ui) return;
    if (ui.win.show() !== 1) return; // cancelado

    var propChoice = ui.ddProp.selection.text;
    var refLayer = ui.getRefLayer();

    var destLayers = comp.selectedLayers;
    if (!destLayers || destLayers.length === 0){
        alert("Selecciona al menos una capa destino en la comp activa.");
        return;
    }

    app.beginUndoGroup("Asignar marcadores (ref: capa en comp activa)");

    // (Opcional) refrescar
    try { comp.openInViewer(); } catch(e){}

    var pairs;
    try { pairs = getMarkerPairsFromLayer(refLayer); }
    catch(err){ alert(err); app.endUndoGroup(); return; }

    var maxPairsUsables = Math.min(pairs.length, destLayers.length);
    if (maxPairsUsables < destLayers.length){
        alert("No hay suficientes pares de marcadores para todas las capas seleccionadas.\n" +
              "Se aplicará solo a las primeras " + maxPairsUsables + " capas.");
    }

    var adjusted = 0, skipped = 0;

    for (var i=0; i<maxPairsUsables; i++){
        var ly = destLayers[i];
        var range = pairs[i];
        var prop = getTransformProp(ly, propChoice);

        if (!prop){ skipped++; continue; }

        // Si la propiedad compuesta no tiene ≥2 keys, probar subprops (X/Y/Z)
        if ((!prop.isTimeVarying || prop.numKeys < 2) && prop.numProperties){
            var ok = false;
            for (var sp=1; sp<=prop.numProperties; sp++){
                var sub = prop.property(sp);
                if (remapKeysToRange(sub, range.IN, range.OUT)){ ok = true; adjusted++; }
            }
            if (!ok) skipped++;
        } else {
            if (remapKeysToRange(prop, range.IN, range.OUT)) adjusted++;
            else skipped++;
        }
    }

    alert("Hecho.\nReferencia: " + refLayer.name +
          "\nCapas/properties ajustadas: " + adjusted + (skipped ? ("\nOmitidas: " + skipped) : ""));

    app.endUndoGroup();
})();
