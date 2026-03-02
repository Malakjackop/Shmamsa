package com.shmamsa.security;

import java.util.List;

public class RoleUtil {

    public static final List<String> ORDERED = List.of(
            "MAKHDOM",
            "KHADIM",
            "AMIN_OSRA",
            "AMIN_KHEDMA",
            "DEVELOPER"
    );

    private static String normalize(String role) {
        if (role == null) return "";
        String r = role.trim().toUpperCase();

        // normalize separators
        r = r.replace(" ", "_");

        // accept common variants
        if (r.contains("DEVELOPER")) return "DEVELOPER";
        if (r.contains("AMIN_KHEDMA")) return "AMIN_KHEDMA";
        if (r.contains("AMIN_OSRA")) return "AMIN_OSRA";
        if (r.contains("KHADIM")) return "KHADIM";
        if (r.contains("MAKHDOM")) return "MAKHDOM";

        return r;
    }

    public static int level(String role) {
        String r = normalize(role);
        int idx = ORDERED.indexOf(r);
        return idx >= 0 ? idx : 0;
    }

    public static boolean isAtLeast(String role, String required) {
        return level(role) >= level(required);
    }

    public static boolean isDeveloper(String role) {
        return normalize(role).equals("DEVELOPER");
    }

    public static boolean canChangeRoles(String actorRole) {
        String r = normalize(actorRole);
        return "AMIN_KHEDMA".equals(r) || "DEVELOPER".equals(r);
    }

    public static boolean canAssign(String actorRole, String targetRole) {
        String ar = normalize(actorRole);
        String tr = normalize(targetRole);

        if ("DEVELOPER".equals(ar)) return true;
        if ("AMIN_KHEDMA".equals(ar)) return !"DEVELOPER".equals(tr);
        return false;
    }
}