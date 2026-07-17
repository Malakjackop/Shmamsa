package com.shmamsa.repository;

import com.shmamsa.model.MemberNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MemberNoteRepository extends JpaRepository<MemberNote, Long> {
    List<MemberNote> findByUserIdOrderByCreatedAtDesc(Long userId);
    long countByUserId(Long userId);
    void deleteByUserId(Long userId);
}
