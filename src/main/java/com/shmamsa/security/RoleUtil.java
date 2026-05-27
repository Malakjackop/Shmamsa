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

    public static int level(String role) {
        if (role == null) return 0;
        String r = role.trim().toUpperCase();
        int idx = ORDERED.indexOf(r);
        return idx >= 0 ? idx : 0;
    }

    public static boolean isAtLeast(String role, String required) {
        if (required == null) return true;
        String req = required.trim().toUpperCase();
        return level(role) >= level(req);
    }

    public static boolean isDeveloper(String role) {
        String r = String.valueOf(role).trim().toUpperCase();
        return "DEVELOPER".equals(r);
    }

    public static boolean canChangeRoles(String actorRole) {
        String r = String.valueOf(actorRole).trim().toUpperCase();
        return "AMIN_KHEDMA".equals(r) || "DEVELOPER".equals(r);
    }

    public static boolean canAssign(String actorRole, String targetRole) {
        String a = String.valueOf(actorRole).trim().toUpperCase();
        String t = String.valueOf(targetRole).trim().toUpperCase();

        if ("DEVELOPER".equals(a)) return true;
        if ("AMIN_KHEDMA".equals(a)) return !"DEVELOPER".equals(t);
        return false;
    }
}