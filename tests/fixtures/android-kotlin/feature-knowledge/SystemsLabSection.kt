package com.dhc6trainer.feature.knowledge.ui.screens

// Reduced fixture mirroring the structure of SystemsLabSection.kt (test data only,
// shortened strings). The build reads: systemsLabOrder, systemsLabShortTitle,
// initialPowerLever/initialPropLever, labSimulation, labTrainingBridge,
// VariantModelContextCard.variantLine and systemsLabDefinition.

internal const val SYSTEMS_LAB_NOTES_PREFS = "dhc6_systems_lab_notes"

private val systemsLabOrder = listOf(
    AircraftSystem.POWERPLANT,
    AircraftSystem.PROPELLER,
    AircraftSystem.FUEL,
    AircraftSystem.AIR_CONDITIONING, // trailing comment with -> arrow
    AircraftSystem.EXHAUST
)

internal enum class LabRendererMode {
    DIAGRAM_2D,
    MODEL_3D_READY
}

internal fun systemsLabShortTitle(system: AircraftSystem): String = when (system) {
    AircraftSystem.AVIONICS -> "Avionics"
    AircraftSystem.POWERPLANT -> "Powerplant"
    AircraftSystem.FUEL -> "Fuel"
    AircraftSystem.AIR_CONDITIONING -> "Air Conditioning"
    else -> system.displayTitle().replace(Regex("^\\d+\\s*"), "")
}

internal fun noteStorageKey(system: AircraftSystem, partId: String): String =
    "${system.name}::$partId"

private fun initialPowerLever(system: AircraftSystem): Float = when (system) {
    AircraftSystem.POWERPLANT,
    AircraftSystem.PROPELLER,
    AircraftSystem.PERFORMANCE -> 0.82f
    else -> 0.46f
}

private fun initialPropLever(system: AircraftSystem): Float = when (system) {
    AircraftSystem.POWERPLANT,
    AircraftSystem.PROPELLER -> 1f
    else -> 0.5f
}

private fun labSimulation(
    system: AircraftSystem,
    powerLever: Float,
    propLever: Float,
    fuelOn: Boolean,
    selectedFault: LabFaultScenario?
): LabSimulation {
    val normalNg = if (fuelOn) (58 + powerLever * 43.5f).roundToInt().coerceAtMost(102) else 0
    val normalNp: Int = when {
        !fuelOn -> 0
        propLever < 0.34f -> 0
        powerLever < 0.12f -> 91
        powerLever < 0.30f -> 44
        propLever > 0.67f -> 96
        else -> (75 + propLever * 15f).roundToInt()
    }
    val normalTorque: Int = when {
        !fuelOn || propLever < 0.34f || powerLever < 0.30f -> 0
        propLever > 0.67f -> (powerLever * 50f).coerceAtMost(50f).roundToInt()
        else -> (powerLever * 40f).roundToInt()
    }
    val normalItt: Int = if (!fuelOn) 120 else when {
        powerLever < 0.12f -> 490
        powerLever < 0.30f -> (490 + (powerLever / 0.30f) * 50).roundToInt()
        powerLever < 0.66f -> (565 + ((powerLever - 0.30f) / 0.36f) * 110).roundToInt()
        else -> (680 + ((powerLever - 0.66f) / 0.34f) * 45).roundToInt()
    }
    val normalFuelFlow = if (fuelOn) (185 + powerLever * 415f).roundToInt() else 0

    fun build(
        effectivePower: Float = powerLever,
        effectiveProp: Float = propLever,
        effectiveFuel: Boolean = fuelOn,
        ng: Int = normalNg,
        np: Int = normalNp,
        torque: Int = normalTorque,
        itt: Int = normalItt,
        fuelFlow: Int = normalFuelFlow,
        observedResult: String,
        indication: String,
        likelyCause: String,
        immediateAction: String,
        qrhBridge: String,
        activePartIds: Set<String> = emptySet(),
        activeFaultId: String? = selectedFault?.id
    ): LabSimulation {
        val metricLine = "NG $ng% • NP $np%"
        return LabSimulation(powerLever = effectivePower, propLever = effectiveProp, fuelOn = effectiveFuel, ng = ng, np = np, torque = torque, itt = itt, fuelFlow = fuelFlow, metricLine = metricLine, observedResult = observedResult, indication = indication, likelyCause = likelyCause, immediateAction = immediateAction, qrhBridge = qrhBridge, activePartIds = activePartIds, activeFaultId = activeFaultId)
    }

    selectedFault?.let { fault ->
        when (fault.id) {
            "hot_start" -> return build(
                effectivePower = 0.22f,
                effectiveProp = 1f,
                effectiveFuel = true,
                ng = 24,
                np = 0,
                torque = 0,
                itt = 925,
                fuelFlow = 360,
                observedResult = "FAULT: ITT/T5 is rising faster than engine acceleration.",
                indication = "High ITT/T5 with low NG and no useful torque.",
                likelyCause = "Fuel/ignition energy is present before the gas generator is accelerating normally.",
                immediateAction = "Abort the start by memory/QRH discipline.",
                qrhBridge = fault.qrhBridge,
                activePartIds = setOf("compressor", "combustor")
            )
            "prop_overspeed" -> return build(
                effectivePower = powerLever.coerceAtLeast(0.72f),
                effectiveProp = 1f,
                effectiveFuel = true,
                ng = 96,
                np = 102,
                torque = 34,
                itt = 720,
                fuelFlow = 520,
                observedResult = "FAULT: NP exceeds the governed limit.",
                indication = "NP above 101.5% with torque unchanged.",
                likelyCause = "Governor is not limiting propeller RPM.",
                immediateAction = "Reduce power, then follow the QRH propeller overspeed drill.",
                qrhBridge = fault.qrhBridge,
                activePartIds = setOf("prop", "gearbox", "csu", "reverse")
            )
            "oil_pressure_loss" -> return build(
                effectivePower = 0.25f,
                effectiveProp = 0f,
                effectiveFuel = fuelOn,
                ng = if (fuelOn) 62 else 0,
                np = 35,
                torque = 6,
                itt = if (fuelOn) 510 else 120,
                fuelFlow = if (fuelOn) 210 else 0,
                observedResult = "FAULT: Propeller control oil pressure is lost.",
                indication = "Low oil-pressure logic, prop moving toward feather.",
                likelyCause = "Loss of propeller governor/control oil pressure.",
                immediateAction = "Treat as an engine/prop control failure and route to QRH.",
                qrhBridge = fault.qrhBridge,
                activePartIds = setOf("prop", "gearbox", "feather")
            )
        }
    }

    val power = powerLeverLabel(powerLever)
    val prop = propLeverLabel(propLever)
    val fuel = if (fuelOn) "ON" else "OFF"
    val t5Limit = when {
        powerLever < 0.30f -> "idle limit 660°C"
        powerLever < 0.84f -> "cruise limit 695°C"
        else -> "T/O limit 725°C"
    }
    val normalText = when (system) {
        AircraftSystem.POWERPLANT ->
            "Normal PT6A-27 model: NG $normalNg% / NP $normalNp% / Torque $normalTorque PSI / T5 $normalItt°C ($t5Limit) / FF $normalFuelFlow lb/hr. Max NG 101.5%, max torque 50 PSI, max T5 725°C (T/O)."
        AircraftSystem.PROPELLER -> {
            val bladeNote = when {
                propLever < 0.34f -> "Blades at feather (~90°)."
                powerLever < 0.12f -> "BETA/REVERSE: NF governor limits NP to 91% in reverse."
                powerLever < 0.30f -> "Below governing: NP ~44% at IDLE."
                propLever > 0.67f -> "FINE: CSU governs to 96% NP."
                else -> "COARSE: CSU governing at reduced RPM."
            }
            "Power $power • Prop $prop • NP $normalNp%. $bladeNote"
        }
        AircraftSystem.FUEL ->
            "Fuel $fuel • FF $normalFuelFlow lb/hr."
        else ->
            "Power $power • Prop $prop • Fuel $fuel. Use the pins to attach technical notes to the selected subsystem part."
    }

    return build(
        observedResult = normalText,
        indication = "Normal indication set for the selected controls.",
        likelyCause = "No fault selected.",
        immediateAction = "Use Look → Move → Observe → Explain → Note → Test.",
        qrhBridge = "Open QRH only when an abnormal cue or checklist link is being studied.",
        activePartIds = emptySet(),
        activeFaultId = null
    )
}

private fun labTrainingBridge(system: AircraftSystem): String = when (system) {
    AircraftSystem.POWERPLANT ->
        "QRH: Engine failure, Engine fire (memory).\nPOH: Section 7.4 – Powerplant."
    AircraftSystem.PROPELLER ->
        "QRH: Propeller overspeed.\nPOH: Section 7.5 – Propeller."
    AircraftSystem.LANDING_GEAR_WHEELS, AircraftSystem.LANDING_GEAR_SKI, AircraftSystem.LANDING_GEAR_FLOATS ->
        "QRH: Gear/float abnormal."
    else ->
        "QRH: Route to the relevant abnormal/emergency section by system."
}

@Composable
private fun VariantModelContextCard(
    definition: SystemsLabDefinition,
    selectedPart: LabPart
) {
    val variantLine = when (definition.system) {
        AircraftSystem.LANDING_GEAR_WHEELS ->
            "Wheel variant: use the complete aircraft model."
        AircraftSystem.LANDING_GEAR_SKI ->
            "Ski variant: use the complete aircraft model to connect nose ski, main skis and winter-operation notes."
        else -> ""
    }
}

private fun systemsLabDefinition(system: AircraftSystem): SystemsLabDefinition = (when (system) {
    AircraftSystem.POWERPLANT -> SystemsLabDefinition(
        system = system,
        objectTitle = "PT6A-27 powerplant — engine-only training model",
        subtitle = "Powerplant is kept engine-only: intake, compressor, combustion, turbines, exhaust and gearboxes.",
        diagramKind = LabDiagramKind.TURBINE,
        rendererMode = LabRendererMode.MODEL_3D_READY,
        modelAsset = LabModelAsset(
            assetPath = "models/systems_lab/models/pt6a27_cutaway_user.glb",
            displayName = "PT6A-27 powerplant GLB",
            nodePrefix = "pt6_",
            requiredNodeIds = listOf("air_inlet_case", "compressor_case", "accessory_gearbox"),
            triangleBudget = "preserve uploaded/validated GLB; do not alter geometry",
            textureBudget = "preserve source materials"
        ),
        drillPrompt = "Trace the PT6A-27 powerplant from intake airflow through compressor, combustion, turbine extraction and exhaust.",
        faults = listOf(
            LabFaultScenario(
                id = "hot_start",
                title = "Hot start / overtemperature trend",
                setup = "Fuel is introduced during start but temperature rises faster than normal acceleration.",
                observedEffect = "ITT/T5 trend becomes the priority cue.",
                qrhBridge = "Connect to abnormal start recognition and engine start-abort discipline."
            ),
            LabFaultScenario(
                id = "engine_fire",
                title = "Engine fire / nacelle isolation",
                setup = "Nacelle fire warning during live engine operation.",
                observedEffect = "The powerplant becomes a shutdown/isolation problem.",
                qrhBridge = "Connect to fire handle, fuel shutoff, generator/bleed isolation and extinguisher discharge."
            )
        ),
        parts = listOf(
            LabPart("air_inlet_case", "Air inlet case", "Note: What is the first airflow reference point?", 0.755f, 0.4f, "The inlet case guides air into the PT6 compressor path.", "Restriction can reduce available power."),
            LabPart("compressor_case", "Compressor case", "Note: Which section contains the compressor path?", 0.62f, 0.46f, "The compressor case surrounds the compressor airflow path.", "Airflow problems can show as low power."),
            LabPart("accessory_gearbox", "Accessory gearbox", "Note: Which section supports engine accessories?", 0.86f, 0.45f, "The accessory gearbox drives engine accessories.", "Accessory-drive issues can affect starting and fuel control.")
        )
    )
    AircraftSystem.PROPELLER -> SystemsLabDefinition(
        system = system,
        objectTitle = "Propeller governor — Open / Normal / Reverse training states",
        subtitle = "Supplied three-state governor visualization.",
        diagramKind = LabDiagramKind.PROPELLER,
        rendererMode = LabRendererMode.MODEL_3D_READY,
        modelAsset = LabModelAsset(
            assetPath = "models/systems_lab/models/prop_governor_open_normal_reverse_animated.glb",
            displayName = "Animated Twin Otter propeller-governor GLB",
            nodePrefix = "",
            requiredNodeIds = listOf(
                "governor_housing", "pilot_valve"
            ),
            triangleBudget = "216,756 triangles",
            textureBudget = "vertex colours; no external textures"
        ),
        drillPrompt = "Compare Open, Normal and Reverse states.",
        faults = listOf(
            LabFaultScenario("governing_fault", "Governor response fault", "Selected propeller RPM is not maintained.", "Compare pilot-valve, oil-pump and overspeed-governor sections.", "Route to the applicable propeller governing / overspeed checklist.")
        ),
        parts = listOf(
            LabPart("governor_housing", "Governor housing and chambers", "Identify the structural housing and internal chambers.", 0.16f, 0.24f, "The housing locates the governor sections.", "Use the Open state to orient internal components."),
            LabPart("pilot_valve", "Pilot valve", "Locate the pilot-valve stem, spool, spring and housing.", 0.52f, 0.24f, "The pilot valve is shown as a discrete metering assembly.", "Verify exact operating logic in approved technical data.")
        )
    )
    AircraftSystem.FUEL -> SystemsLabDefinition(
        system = system,
        objectTitle = "Twin Otter fuel system — tanks, boost supply, crossfeed and engine feeds",
        subtitle = "Training-grade aircraft-context model.",
        diagramKind = LabDiagramKind.FUEL,
        rendererMode = LabRendererMode.MODEL_3D_READY,
        modelAsset = LabModelAsset(
            assetPath = "models/systems_lab/models/fuel_system.glb",
            displayName = "Training-grade Twin Otter fuel-system GLB",
            nodePrefix = "",
            requiredNodeIds = listOf("fwd_tank", "aft_tank"),
            triangleBudget = "preserve",
            textureBudget = "preserve"
        ),
        drillPrompt = "Trace fuel from the tanks to the engines.",
        faults = listOf(
            LabFaultScenario("boost_pump_fault", "Boost pump fault", "One boost pump fails.", "Fuel pressure caution.", "Connect to the boost pump failure checklist.")
        ),
        parts = listOf(
            LabPart("fwd_tank", "Forward tank", "Which engine does the FWD tank feed in NORM?", 0.3f, 0.5f, "Forward tank group.", "Imbalance affects CG."),
            LabPart("aft_tank", "Aft tank", "Which engine does the AFT tank feed in NORM?", 0.7f, 0.5f, "Aft tank group.", "Imbalance affects CG.")
        )
    )
    AircraftSystem.AIR_CONDITIONING -> SystemsLabDefinition(
        system = system,
        objectTitle = "Later-production air-conditioning installation",
        subtitle = "Vapour-cycle system.",
        diagramKind = LabDiagramKind.AIR_CONDITIONING,
        rendererMode = LabRendererMode.MODEL_3D_READY,
        modelAsset = LabModelAsset(
            assetPath = "models/systems_lab/models/air_conditioning_system.glb",
            displayName = "A/C GLB",
            nodePrefix = "",
            requiredNodeIds = listOf("Floor_Panel"),
            triangleBudget = "preserve",
            textureBudget = "preserve"
        ),
        drillPrompt = "Trace the refrigerant loop.",
        parts = listOf(
            LabPart("structure", "Structure and stations", "Identify the floor and bulkheads.", 0.5f, 0.5f, "Structure group.", "None.")
        )
    )
    AircraftSystem.LANDING_GEAR_SKI -> SystemsLabDefinition(
        system = system,
        objectTitle = "Ski undercarriage — arctic/winter operations",
        subtitle = "Ski variant.",
        diagramKind = LabDiagramKind.GENERAL,
        rendererMode = LabRendererMode.MODEL_3D_READY,
        modelAsset = LabModelAsset(
            assetPath = "models/systems_lab/models/dhc6_skis_painted_training_mobile_no_draco.glb",
            displayName = "Ski GLB",
            nodePrefix = "ski_",
            requiredNodeIds = listOf("Ski_Nose"),
            triangleBudget = "preserve",
            textureBudget = "preserve"
        ),
        drillPrompt = "Identify the ski installation.",
        parts = listOf(
            LabPart("skis", "Skis", "Identify the nose and main skis.", 0.5f, 0.2f, "Ski installation.", "Performance changes.")
        )
    )
    AircraftSystem.EXHAUST -> SystemsLabDefinition(
        system = system,
        objectTitle = system.displayTitle(),
        subtitle = "Reference only.",
        diagramKind = LabDiagramKind.GENERAL,
        rendererMode = LabRendererMode.DIAGRAM_2D,
        drillPrompt = "",
        parts = listOf(
            LabPart("general", system.displayTitle(), "Note", 0.5f, 0.5f, "General.", "None.")
        )
    )
    else -> SystemsLabDefinition(
        system = system,
        objectTitle = system.displayTitle(),
        subtitle = "",
        diagramKind = LabDiagramKind.GENERAL,
        drillPrompt = "",
        parts = emptyList()
    )
})
