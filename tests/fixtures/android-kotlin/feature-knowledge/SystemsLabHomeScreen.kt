package com.dhc6trainer.feature.knowledge.ui.screens

// Reduced fixture mirroring the structure of SystemsLabHomeScreen.kt (test data only).

private enum class SystemsLabHomeLane { AIRCRAFT, NOTES }

private val aircraftExplorerSystems = listOf(
    AircraftSystem.POWERPLANT,
    AircraftSystem.PROPELLER,
    AircraftSystem.FUEL,
    AircraftSystem.AIR_CONDITIONING
)

@Composable
private fun AircraftHeroExplorer(onOpenSystem: (AircraftSystem) -> Unit) {
    val hero = remember(source) {
        source.copy(
            objectTitle = "DHC-6 Series 300 aircraft explorer",
            subtitle = "Drag to orbit, pinch to zoom, then select a system.",
            modelAsset = LabModelAsset(
                assetPath = "models/systems_lab/models/dhc6_wheels_high_def_mobile_no_draco.glb",
                displayName = "DHC-6 Series 300",
                nodePrefix = "",
                requiredNodeIds = emptyList(),
                triangleBudget = "Mobile optimised",
                textureBudget = "Mobile optimised"
            )
        )
    }
}

private data class ExplorerHotspot(
    val id: String,
    val system: AircraftSystem,
    val label: String,
    val fx: Float,
    val fy: Float,
    val fz: Float
)

// Twin engine/prop each get a left + right marker (offset on fx).
private val explorerExteriorHotspots = listOf(
    ExplorerHotspot("PROP_L", AircraftSystem.PROPELLER, "Propeller", 0.32f, 0.56f, 0.14f),
    ExplorerHotspot("PROP_R", AircraftSystem.PROPELLER, "Propeller", 0.68f, 0.56f, 0.14f),
    ExplorerHotspot("PWR_L", AircraftSystem.POWERPLANT, "Powerplant", 0.32f, 0.56f, 0.30f)
)

private val explorerInternalSystems = listOf(
    AircraftSystem.FUEL,
    AircraftSystem.AIR_CONDITIONING
)
