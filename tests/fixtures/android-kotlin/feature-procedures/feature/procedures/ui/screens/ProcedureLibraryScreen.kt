package fixture

private fun normalProcedureBucketFor(procedure: Procedure): NormalProcedureBucket {
    return when (normalizeProcedureKey(procedure.procedureName)) {
        "system test one",
        "system test two" -> NormalProcedureBucket.SYSTEM_TESTS
        "test normal" -> NormalProcedureBucket.WEATHER_SPECIAL_CONDITIONS
        else -> NormalProcedureBucket.EVERYDAY_ACTIONS
    }
}

private fun normalProcedureSortIndex(procedure: Procedure): Int {
    return when (normalizeProcedureKey(procedure.procedureName)) {
        "system test one" -> 101
        "system test two" -> 102
        "test normal" -> 201
        else -> 999
    }
}
